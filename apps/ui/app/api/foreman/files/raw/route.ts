import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { parseByteRange } from '@/lib/files/byte-range'
import { rawFileHeaders } from '@/lib/files/content-type'
import { invalidDir, invalidName } from '@/lib/files/path-guards'
import { FOREMAN_FILES_BUCKET, foremanFileKey } from '@/lib/foreman/files'
import { downloadPrivateFile } from '@/lib/storage/private'
import { withQueryWorkspace } from '@/lib/workspace/query-workspace'

async function read(req: Request) {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const path = url.searchParams.get('path') ?? ''
    if (!sessionId || invalidName(sessionId)) return Response.json({ error: 'Invalid session id' }, { status: 400 })
    if (!path || invalidDir(path)) return Response.json({ error: 'Invalid path' }, { status: 400 })

    try {
        const blob = await downloadPrivateFile(ctx.supabase, FOREMAN_FILES_BUCKET, foremanFileKey(ctx, sessionId, path))
        const range = parseByteRange(req.headers.get('range'), blob.size)
        if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}`, 'Accept-Ranges': 'bytes' } })

        const headers = {
            ...rawFileHeaders(path),
            'Cache-Control': 'private, max-age=60',
            'Accept-Ranges': 'bytes',
        }
        if (!range) return new Response(blob.stream(), { status: 200, headers: { ...headers, 'Content-Length': String(blob.size) } })
        return new Response(blob.slice(range.start, range.end + 1).stream(), {
            status: 206,
            headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${blob.size}` },
        })
    } catch {
        return Response.json({ error: 'File not found' }, { status: 404 })
    }
}

export const GET = withQueryWorkspace(read)
