'use server'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { supportsForemanFiles } from '@/lib/engine/client'
import { FOREMAN_FILES_BUCKET, foremanFileKey } from '@/lib/foreman/files'
import { readForemanFile } from '@/lib/foreman/read-attachment'
import { removePrivateFiles } from '@/lib/storage/private'

export async function deleteForemanFileAction(sessionId: string, path: string): Promise<void> {
    const ctx = await requireWorkspaceContext()
    await removePrivateFiles(ctx.supabase, FOREMAN_FILES_BUCKET, [foremanFileKey(ctx, sessionId, path)])
}

export async function readForemanFileAction(sessionId: string, path: string): Promise<{ content: string; truncated: boolean }> {
    const ctx = await requireWorkspaceContext()
    return readForemanFile(ctx, sessionId, path)
}

export async function foremanEngineFilesAction(): Promise<boolean> {
    try {
        const ctx = await requireWorkspaceContext()
        return await supportsForemanFiles(await getWorkspaceConnection(ctx.workspace.id))
    } catch {
        return false
    }
}
