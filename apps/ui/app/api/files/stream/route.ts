import { LEGACY_UPLOAD_MAX_BYTES, MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { resolveRunTarget } from '@/app/api/_services/chat.service'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import * as engine from '@/lib/engine/client'
import { invalidDir, invalidName } from '@/lib/files/path-guards'
import type { EngineConnection } from '@/lib/engine/types'
import { withQueryWorkspace } from '@/lib/workspace/query-workspace'
import { getTranslations } from 'next-intl/server'

export const runtime = 'nodejs'

const MB = 1024 * 1024

async function resolveTarget(agentId: string | null, shared: boolean): Promise<{ conn: EngineConnection; base: string }> {
    if (agentId) {
        const target = await resolveRunTarget(agentId)
        return { conn: target.conn, base: `/agents/${target.engineAgentId}/files` }
    }
    if (shared) {
        return { conn: await requireWorkspaceConnection(), base: '/shared/files' }
    }
    throw new AuthorizationError('missingFileTarget')
}

async function upload(req: Request) {
    const url = new URL(req.url)
    const agentId = url.searchParams.get('agentId')
    const shared = url.searchParams.get('scope') === 'shared'
    const dir = url.searchParams.get('dir') ?? ''
    const name = url.searchParams.get('name') ?? ''
    const size = Number(url.searchParams.get('size') ?? 0)

    if (invalidName(name)) return Response.json({ error: 'Invalid file name' }, { status: 400 })
    if (invalidDir(dir)) return Response.json({ error: 'Invalid directory' }, { status: 400 })
    const t = await getTranslations('files.uploadOutcome')
    if (size > MAX_UPLOAD_FILE_BYTES) {
        return Response.json({ error: t('oversized', { names: name, more: 0, count: 1, limit: MAX_UPLOAD_FILE_BYTES / MB }) }, { status: 413 })
    }
    if (!req.body) return Response.json({ error: 'Expected the file bytes as the request body' }, { status: 400 })

    try {
        const { conn, base } = await resolveTarget(agentId, shared)

        if (!(await engine.supportsStreamedUploads(conn))) {
            return await uploadThroughLegacyRoute(conn, base, { dir, name, size, req }, t)
        }

        try {
            const result = await engine.uploadFileStream(conn, base, { dir, name, body: req.body, size: size || null, signal: req.signal })
            return Response.json(result, { status: 201 })
        } catch (err) {
            // The capability cache can outlive a Box that rolled back. Falling back once beats
            // failing an upload the old route could still have carried.
            if (err instanceof engine.EngineUploadError && (err.status === 404 || err.status === 405)) {
                engine.forgetEngineCapabilities(conn)
                return Response.json({ error: t('machineUpdating') }, { status: 409 })
            }
            throw err
        }
    } catch (err) {
        return errorResponse(err, name, t)
    }
}

// A machine whose engine predates the streamed route can still take the multipart one, as long as the
// file is small enough for it to hold in memory twice.
type UploadCopy = Awaited<ReturnType<typeof getTranslations<'files.uploadOutcome'>>>

async function uploadThroughLegacyRoute(conn: EngineConnection, base: string, input: { dir: string; name: string; size: number; req: Request }, t: UploadCopy): Promise<Response> {
    if (input.size > LEGACY_UPLOAD_MAX_BYTES) {
        return Response.json(
            { error: t('engineUpdateNeeded', { limit: LEGACY_UPLOAD_MAX_BYTES / MB }) },
            { status: 409 },
        )
    }
    const blob = await input.req.blob()
    await engine.uploadFile(conn, base, new File([blob], input.name), input.dir)
    return Response.json({ path: [input.dir, input.name].filter(Boolean).join('/'), bytes: blob.size }, { status: 201 })
}

function errorResponse(err: unknown, name: string, t: UploadCopy): Response {
    if (err instanceof AuthorizationError) return Response.json({ error: err.message }, { status: 403 })
    if (err instanceof engine.EngineUploadError) {
        const status = err.status === 400 || err.status === 507 ? err.status : 502
        return Response.json({ error: err.message }, { status })
    }
    if (err instanceof Error && err.name === 'AbortError') return new Response(null, { status: 499 })
    return Response.json({ error: t('machineUnreachable', { name }) }, { status: 502 })
}

export const POST = withQueryWorkspace(upload)
