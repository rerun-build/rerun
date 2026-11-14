import { resolveRunTarget } from '@/app/api/_services/chat.service'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import * as engine from '@/lib/engine/client'
import { rawFileHeaders } from '@/lib/files/content-type'
import { withQueryWorkspace } from '@/lib/workspace/query-workspace'

const RANGE_HEADERS = ['Accept-Ranges', 'Content-Range', 'Content-Length'] as const

function pickHeaders(res: Response, names: readonly string[]): Record<string, string> {
    return Object.fromEntries(names.flatMap(name => {
        const value = res.headers.get(name)
        return value === null ? [] : [[name, value]]
    }))
}

async function read(req: Request) {
    try {
        const url = new URL(req.url)
        const path = url.searchParams.get('path')
        const agentId = url.searchParams.get('agentId')
        const shared = url.searchParams.get('scope') === 'shared'

        if (!path) {
            return Response.json({ error: 'Missing path' }, { status: 400 })
        }

        let conn
        let base
        if (agentId) {
            const target = await resolveRunTarget(agentId)
            conn = target.conn
            base = `/agents/${target.engineAgentId}/files`
        } else if (shared) {
            conn = await requireWorkspaceConnection()
            base = '/shared/files'
        } else {
            return Response.json({ error: 'Missing agentId or scope=shared' }, { status: 400 })
        }

        const res = await engine.fetchRawFile(conn, base, path, req.headers.get('range'))
        if (res.status === 416) {
            return new Response(null, { status: 416, headers: pickHeaders(res, RANGE_HEADERS) })
        }
        if (!res.ok || !res.body) {
            return Response.json({ error: 'File not found' }, { status: res.status === 404 ? 404 : 502 })
        }

        return new Response(res.body, {
            status: res.status === 206 ? 206 : 200,
            headers: {
                ...pickHeaders(res, RANGE_HEADERS),
                ...rawFileHeaders(path),
                'Cache-Control': 'private, max-age=60',
            },
        })
    } catch (err) {
        console.error('[files/raw] failed', new URL(req.url).search, err)
        return Response.json({ error: err instanceof Error ? err.message : 'Failed to read file' }, { status: 500 })
    }
}

export const GET = withQueryWorkspace(read)
