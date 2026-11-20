import { readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import type { Client, Row } from '@libsql/client'
import { capabilityOfCall, isPaidDataTool, PAID_DATA_TOOL, parseHubOutput, stripBridgePrefix } from '@moldwright/contracts'
import { workspaceDir } from '../config/paths.js'
import { logger } from '../lib/logger.js'
import { paidCallVerdict } from './sources.js'
import { writePaidSources } from './store.js'

const PAGE = 200
const SAVED_ANSWERS_DIR = '.rerun/paid-data/'
const BACKFILL_DONE_KEY = 'paid_backfill'

type RecordedPaidOutput = { status?: unknown; servedBy?: unknown; saved?: unknown; result?: unknown }

function parseJson(text: unknown): unknown {
    if (typeof text !== 'string') return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

async function savedOutput(agentId: string, saved: unknown): Promise<unknown> {
    if (typeof saved !== 'string' || !saved.startsWith(SAVED_ANSWERS_DIR)) return undefined
    const name = saved.slice(SAVED_ANSWERS_DIR.length)
    if (!name || name !== basename(name) || name.startsWith('.')) return undefined
    const root = workspaceDir(agentId)
    const file = resolve(root, saved)
    if (!file.startsWith(root + sep)) return undefined
    const answer = parseJson(await readFile(file, 'utf8').catch(() => null)) as { output?: unknown } | null
    return answer?.output
}

async function backfillCall(client: Client, row: Row): Promise<void> {
    const toolName = stripBridgePrefix(String(row.tool_name))
    const input = parseJson(row.input_json) as { capability?: unknown; params?: unknown } | null
    const capability = capabilityOfCall(toolName, input) ?? (toolName === PAID_DATA_TOOL && typeof input?.capability === 'string' ? input.capability : null)
    if (!capability) return
    const params = toolName === PAID_DATA_TOOL ? input?.params : input

    const recorded = parseHubOutput<RecordedPaidOutput>(parseJson(row.result_json))
    if (!recorded || recorded.status !== 'found') return
    const result = recorded.result && typeof recorded.result === 'object' ? (recorded.result as { output?: unknown }) : null
    const output = (await savedOutput(String(row.agent_id), recorded.saved)) ?? result?.output
    if (output === undefined) return

    await writePaidSources(client, {
        callId: String(row.tool_call_id ?? row.id),
        at: String(row.created_at),
        capability,
        servedBy: typeof recorded.servedBy === 'string' ? recorded.servedBy : null,
        output,
        ...paidCallVerdict(capability, params, result),
    })
}

async function backfillDone(client: Client): Promise<boolean> {
    const rs = await client.execute({ sql: 'SELECT value FROM system_meta WHERE key = ?', args: [BACKFILL_DONE_KEY] })
    return rs.rows.length > 0
}

export async function backfillPaidSources(client: Client, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || (await backfillDone(client))) return
    const names = (await client.execute('SELECT DISTINCT tool_name FROM tool_calls')).rows.map(row => String(row.tool_name)).filter(name => isPaidDataTool(stripBridgePrefix(name)))
    let indexed = 0
    for (let offset = 0; names.length; offset += PAGE) {
        if (signal?.aborted) return
        const page = await client.execute({
            sql: `SELECT id, agent_id, tool_call_id, tool_name, input_json, result_json, created_at FROM tool_calls WHERE tool_name IN (${names.map(() => '?').join(', ')}) ORDER BY created_at, id LIMIT ? OFFSET ?`,
            args: [...names, PAGE, offset],
        })
        for (const row of page.rows) {
            if (signal?.aborted) return
            await backfillCall(client, row).catch(err => {
                if (!signal?.aborted) logger.warn({ err: String(err), toolCallId: row.tool_call_id }, 'could not index a past paid data call')
            })
            indexed += 1
        }
        if (page.rows.length < PAGE) break
    }
    if (signal?.aborted) return
    await client.execute({ sql: 'INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)', args: [BACKFILL_DONE_KEY, new Date().toISOString()] })
    if (indexed) logger.info({ indexed }, 'indexed the past paid data calls')
}

let queue: Promise<void> = Promise.resolve()

export function scheduleBackfillPaidSources(client: Client, agentId: string, signal?: AbortSignal): Promise<void> {
    const task = queue
        .then(() => backfillPaidSources(client, signal))
        .catch(err => {
            if (!signal?.aborted && !String(err).includes('CLIENT_CLOSED')) logger.warn({ err: String(err), agentId }, 'could not index the past paid data calls')
        })
    queue = task
    return task
}
