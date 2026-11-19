import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { mediaContentType } from '@/lib/files/content-type'
import { invalidDir, invalidName } from '@/lib/files/path-guards'
import { FOREMAN_FILES_BUCKET, foremanFileKey } from '@/lib/foreman/files'
import { FOREMAN_MAX_UPLOAD_BYTES } from '@/lib/foreman/upload-limit'
import { uploadPrivateFile } from '@/lib/storage/private'
import { withQueryWorkspace } from '@/lib/workspace/query-workspace'
import { getTranslations } from 'next-intl/server'

export const runtime = 'nodejs'

const MB = 1024 * 1024

// The foreman's counterpart of /api/files/stream. Same contract on the wire, a different store
// behind it: there is no Box under the foreman, so its attachments and voice notes go to a private
// bucket keyed by workspace, member and conversation.
async function upload(req: Request) {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized', code: 'notAuthenticated' }, { status: 401 })
    }

    const url = new URL(req.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const dir = url.searchParams.get('dir') ?? ''
    const name = url.searchParams.get('name') ?? ''
    const size = Number(url.searchParams.get('size') ?? 0)

    if (!sessionId || invalidName(sessionId)) return Response.json({ error: 'Invalid session id' }, { status: 400 })
    if (invalidName(name)) return Response.json({ error: 'Invalid file name' }, { status: 400 })
    if (invalidDir(dir)) return Response.json({ error: 'Invalid directory' }, { status: 400 })
    const t = await getTranslations('files.uploadOutcome')
    const oversized = () => Response.json({ error: t('oversized', { names: name, more: 0, count: 1, limit: FOREMAN_MAX_UPLOAD_BYTES / MB }) }, { status: 413 })
    if (size > FOREMAN_MAX_UPLOAD_BYTES) return oversized()
    if (!req.body) return Response.json({ error: 'Expected the file bytes as the request body' }, { status: 400 })

    const path = dir ? `${dir}/${name}` : name
    try {
        const bytes = new Uint8Array(await req.arrayBuffer())
        if (bytes.byteLength > FOREMAN_MAX_UPLOAD_BYTES) return oversized()
        await uploadPrivateFile(ctx.supabase, FOREMAN_FILES_BUCKET, foremanFileKey(ctx, sessionId, path), bytes, mediaContentType(name) ?? 'application/octet-stream')
        return Response.json({ path, bytes: bytes.byteLength }, { status: 201 })
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Failed to save the file' }, { status: 500 })
    }
}

export const POST = withQueryWorkspace(upload)
