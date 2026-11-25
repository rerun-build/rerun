import 'server-only'
import { getWorkspaceConnection, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { callerIp } from '@/lib/auth/caller-ip'
import { agentDataBase, EngineRequestError, EngineUnreachableError, engineRefusal, insertDbTableRow, listDbTables, readDbTableRows, SPACE_DATA_BASE, updateDbTableRow } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { claimDataRead, claimDataWrite } from '@/lib/published/codes'
import { findDataGrant, parseDataGrants, SHARED_DATABASE, type DataGrant } from '@/lib/published/data-grants'
import type { PublishedEntry } from '@/lib/published/gate'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { isUuid, rowFilterSchema, type RowFilter } from '@rerun/contracts'
import { z } from 'zod'

// `/__rerun/data/*` on a published host: the page's own way into the tables it was granted, and to
// nothing else of the machine. The route has already checked that the visitor may open the page.
//
//   GET   tables                      → { tables: [{ name, grant, columns }] }
//   GET   tables/<name>/rows          → { columns, rows, total }   (limit, offset, sort, dir, q, where)
//   POST  tables/<name>/rows          → { row }                    (write grant)
//   PATCH tables/<name>/rows/<rowid>  → { row }                    (write grant)

export type DataEntry = Pick<PublishedEntry, 'slug' | 'workspace_id' | 'data_tables'>

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_BODY_BYTES = 64 * 1024
const MAX_COLUMNS = 50
const MAX_VALUE_LENGTH = 10_000

const HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Robots-Tag': 'noindex',
    'Cache-Control': 'no-store',
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: HEADERS })
}

function refuse(status: number, error: string): Response {
    return json({ error }, status)
}

async function databaseBase(database: string, workspaceId: number): Promise<string | null> {
    if (database === SHARED_DATABASE) return SPACE_DATA_BASE
    if (!isUuid(database)) return null
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'agents', ['engine_agent_id'] as const, { id: database, workspace_id: workspaceId })
    return data?.engine_agent_id ? agentDataBase(data.engine_agent_id) : null
}

async function databaseBases(grants: readonly DataGrant[], workspaceId: number): Promise<Map<string, string>> {
    const bases = new Map<string, string>()
    if (grants.some(grant => grant.database === SHARED_DATABASE)) bases.set(SHARED_DATABASE, SPACE_DATA_BASE)
    const agentIds = [...new Set(grants.map(grant => grant.database).filter(database => database !== SHARED_DATABASE && isUuid(database)))]
    if (agentIds.length === 0) return bases
    const { data } = await selectMany(createServiceRoleClient(), 'agents', ['id', 'engine_agent_id'] as const, { id: agentIds, workspace_id: workspaceId })
    for (const agent of data ?? []) if (agent.engine_agent_id) bases.set(agent.id, agentDataBase(agent.engine_agent_id))
    return bases
}

function engineFailure(err: unknown): Response {
    if (err instanceof NoEngineError || err instanceof EngineUnreachableError) return refuse(503, 'The workspace is not reachable right now.')
    if (err instanceof EngineRequestError) {
        if (err.status === 404) return refuse(503, 'The workspace needs an update to serve this page.')
        if (err.status === 400) return refuse(400, engineRefusal(err) ?? 'The request was refused.')
    }
    console.error('[published-data] engine call failed:', err)
    return refuse(502, 'The data could not be read.')
}

async function listGranted(entry: DataEntry, grants: readonly DataGrant[], conn: EngineConnection): Promise<Response> {
    const bases = await databaseBases(grants, entry.workspace_id)
    const listed = await Promise.all([...new Set(bases.values())].map(async base => [base, await listDbTables(conn, base)] as const))
    const byBase = new Map(listed)
    const tables = grants.flatMap(grant => {
        const base = bases.get(grant.database)
        const table = base ? byBase.get(base)?.find(candidate => candidate.name === grant.table) : undefined
        return table ? [{ name: table.name, grant: grant.grant, columns: table.columns }] : []
    })
    return json({ tables })
}

function parseWhere(raw: string | null): RowFilter[] | undefined | null {
    if (!raw) return undefined
    try {
        const parsed = JSON.parse(raw) as unknown
        const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.entries(parsed).map(([column, equals]) => ({ column, equals })) : null
        const result = z.array(rowFilterSchema).safeParse(list)
        return result.success ? result.data : null
    } catch {
        return null
    }
}

async function readRows(url: URL, conn: EngineConnection, base: string, table: string): Promise<Response> {
    const where = parseWhere(url.searchParams.get('where'))
    if (where === null) return refuse(400, 'where must be a JSON object of column: value, or a list of { column, equals }.')
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
    const dir = url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
    const columns = url.searchParams.get('columns')?.split(',').map(column => column.trim()).filter(Boolean)
    return json(
        await readDbTableRows(conn, base, table, {
            limit,
            offset,
            sort: url.searchParams.get('sort') || undefined,
            dir,
            q: url.searchParams.get('q') || undefined,
            columns,
            where,
        })
    )
}

type RowValues = Record<string, string | number | boolean | null>

// A write comes from the page itself: a form on another site cannot post here with the visitor's
// access cookie, since a JSON body needs a preflight and the Origin names the page.
function writeRefusal(request: Request, origin: string): Response | null {
    if (request.headers.get('origin') !== origin) return refuse(403, 'Writes are only accepted from the page itself.')
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return refuse(415, 'Send the row as JSON.')
    return null
}

const TOO_LARGE = 'The row is too large.'

// Stops reading as soon as the body passes the cap, whether or not it announced its length.
async function readCappedText(request: Request): Promise<string | null> {
    if (!request.body) return ''
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => {})
            return null
        }
        chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
}

async function readValues(request: Request): Promise<RowValues | string> {
    const text = await readCappedText(request)
    if (text === null) return TOO_LARGE
    let body: unknown
    try {
        body = JSON.parse(text)
    } catch {
        return 'Send the row as JSON: { "values": { "column": "value" } }.'
    }
    const values = (body as { values?: unknown } | null)?.values
    if (!values || typeof values !== 'object' || Array.isArray(values)) return 'Send the row as JSON: { "values": { "column": "value" } }.'
    const entries = Object.entries(values)
    if (entries.length === 0) return 'The row has no values.'
    if (entries.length > MAX_COLUMNS) return 'The row has too many columns.'
    for (const [column, value] of entries) {
        if (column === '__rowid') return 'The rowid is set by the database.'
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return `The value of ${column} must be text, a number, true, false or null.`
        if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) return `The value of ${column} is too long.`
    }
    return values as RowValues
}

async function writeRow(entry: DataEntry, request: Request, origin: string, write: (values: RowValues) => Promise<Record<string, unknown>>, status: number): Promise<Response> {
    const refusal = writeRefusal(request, origin)
    if (refusal) return refusal
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return refuse(413, TOO_LARGE)
    if (!(await claimDataWrite(entry.slug, callerIp(request.headers)))) return refuse(429, 'Too many changes from this page. Try again in a minute.')
    const values = await readValues(request)
    if (values === TOO_LARGE) return refuse(413, values)
    if (typeof values === 'string') return refuse(400, values)
    return json({ row: await write(values) }, status)
}

export async function answerDataRequest(entry: DataEntry, request: Request, path: string[], origin: string): Promise<Response> {
    const grants = parseDataGrants(entry.data_tables)
    const method = request.method
    const [section, table, rows, rowid, ...rest] = path
    if (section !== 'tables' || rest.length > 0) return refuse(404, 'Not found.')

    if (method === 'GET' && !(await claimDataRead(entry.slug, callerIp(request.headers)))) return refuse(429, 'Too many reads from this page. Try again in a minute.')

    try {
        if (!table) {
            if (method !== 'GET') return refuse(405, 'Method not allowed.')
            if (grants.length === 0) return json({ tables: [] })
            return await listGranted(entry, grants, await getWorkspaceConnection(entry.workspace_id))
        }

        const grant = findDataGrant(grants, table)
        if (!grant || rows !== 'rows') return refuse(404, 'Not found.')
        const base = await databaseBase(grant.database, entry.workspace_id)
        if (!base) return refuse(404, 'Not found.')

        if (rowid === undefined && method === 'GET') return await readRows(new URL(request.url), await getWorkspaceConnection(entry.workspace_id), base, table)
        if (rowid === undefined && method !== 'POST') return refuse(405, 'Method not allowed.')
        if (rowid !== undefined && method !== 'PATCH') return refuse(405, 'Method not allowed.')
        if (grant.grant !== 'write') return refuse(403, 'This page may only read this table.')
        if (rowid !== undefined && !/^\d+$/.test(rowid)) return refuse(404, 'Not found.')

        const conn = await getWorkspaceConnection(entry.workspace_id)
        if (rowid === undefined) return await writeRow(entry, request, origin, values => insertDbTableRow(conn, base, table, values), 201)
        return await writeRow(entry, request, origin, values => updateDbTableRow(conn, base, table, rowid, values), 200)
    } catch (err) {
        return engineFailure(err)
    }
}
