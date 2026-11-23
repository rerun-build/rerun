'use server'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { supportsForemanAgent, supportsForemanCoworker, supportsForemanFiles } from '@/lib/engine/client'
import { FOREMAN_FILES_BUCKET, foremanFileKey } from '@/lib/foreman/files'
import { readForemanFile } from '@/lib/foreman/read-attachment'
import { removePrivateFiles } from '@/lib/storage/private'

/** Drops an attachment the user took back out of the composer after its bytes had landed. */
export async function deleteForemanFileAction(sessionId: string, path: string): Promise<void> {
    const ctx = await requireWorkspaceContext()
    await removePrivateFiles(ctx.supabase, FOREMAN_FILES_BUCKET, [foremanFileKey(ctx, sessionId, path)])
}

/** Backs the lightbox when the user opens a text attachment of a foreman conversation. */
export async function readForemanFileAction(sessionId: string, path: string): Promise<{ content: string; truncated: boolean }> {
    const ctx = await requireWorkspaceContext()
    return readForemanFile(ctx, sessionId, path)
}

/**
 * Whether the foreman on the workspace's engine takes files in its own workspace. Boxes update on
 * their own schedule, and one that predates it answers 403 to every upload.
 */
export async function foremanEngineFilesAction(): Promise<boolean> {
    try {
        const ctx = await requireWorkspaceContext()
        return await supportsForemanFiles(await getWorkspaceConnection(ctx.workspace.id))
    } catch {
        return false
    }
}

// What the workspace's machine opens on the Chief of Staff's card: its own things (`card`), and the
// screens of a coworker's card besides (`agent`: its activity and its settings).
export async function foremanCoworkerAction(): Promise<{ card: boolean; agent: boolean }> {
    try {
        const ctx = await requireWorkspaceContext()
        const conn = await getWorkspaceConnection(ctx.workspace.id)
        const [card, agent] = await Promise.all([supportsForemanCoworker(conn), supportsForemanAgent(conn)])
        return { card, agent }
    } catch {
        return { card: false, agent: false }
    }
}
