import { getAgentChatTarget } from '@/app/api/_services/chat.service'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import * as engine from '@/lib/engine/client'
import { rowFilterSchema } from '@moldwright/contracts'
import { z } from 'zod'
import { withQueryWorkspace } from '@/lib/workspace/query-workspace'

async function read(req: Request) {
    try {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        const shared = url.searchParams.get('scope') === 'shared'
        const table = url.searchParams.get('table')
        const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv'
        const sort = url.searchParams.get('sort') ?? undefined
        const dir = url.searchParams.get('dir') === 'desc' ? 'desc' : url.searchParams.get('dir') === 'asc' ? 'asc' : undefined
        const q = url.searchParams.get('q') ?? undefined
        const rawWhere = url.searchParams.get('where')
        const where = rawWhere ? z.array(rowFilterSchema).parse(JSON.parse(rawWhere)) : undefined

        if ((!agentId && !shared) || !table) {
            return Response.json({ error: 'Missing agentId or scope=shared, or missing table' }, { status: 400 })
        }

        const { conn, base } = shared
            ? { conn: await requireWorkspaceConnection(), base: engine.SPACE_DATA_BASE }
            : await getAgentChatTarget(agentId!).then(t => ({ conn: t.conn, base: engine.agentDataBase(t.engineAgentId) }))
        const res = await engine.exportDbTable(conn, base, table, { format, sort, dir, q, where })
        if (!res.ok || !res.body) {
            return Response.json({ error: 'Export failed' }, { status: res.status === 404 ? 404 : 502 })
        }

        return new Response(res.body, {
            status: 200,
            headers: {
                'Content-Type': res.headers.get('Content-Type') ?? (format === 'json' ? 'application/json' : 'text/csv'),
                'Content-Disposition': res.headers.get('Content-Disposition') ?? `attachment; filename="${table}.${format}"`,
            },
        })
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Failed to export table' }, { status: 500 })
    }
}

export const GET = withQueryWorkspace(read)
