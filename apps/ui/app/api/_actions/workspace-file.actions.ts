'use server'

import { saveTextFile, type SaveFileResult } from '@/app/api/_services/file.service'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'

export type FileEntry = {
    name: string
    type: 'file' | 'dir' | 'symlink'
    size: number
    modified: string
}

export async function listWorkspaceFilesAction(relativePath = '', showHidden = false): Promise<{ entries: FileEntry[]; path: string }> {
    const conn = await requireWorkspaceConnection().catch(err => {
        if (err instanceof NoEngineError) return null
        throw err
    })
    if (!conn) return { entries: [], path: relativePath }
    const entries = await engine.listFiles(conn, engine.SHARED_FILES_BASE, relativePath || '.')
    const mapped: FileEntry[] = entries
        .filter(e => showHidden || !e.name.startsWith('.'))
        .map(e => ({ name: e.name, type: e.type, size: e.size, modified: '' }))
    return { entries: mapped, path: relativePath }
}

export async function readWorkspaceFileAction(filePath: string): Promise<{ content: string; truncated: boolean }> {
    const conn = await requireWorkspaceConnection()
    const page = await engine.readFileText(conn, engine.SHARED_FILES_BASE, filePath)
    return { content: page.content, truncated: page.truncated ?? page.content.length >= TEXT_FILE_PAGE_CHARS }
}

export async function writeWorkspaceFileAction(filePath: string, content: string, baseHash: string | null): Promise<SaveFileResult> {
    const conn = await requireWorkspaceConnection()
    return saveTextFile(conn, engine.SHARED_FILES_BASE, filePath, content, baseHash)
}

export async function deleteWorkspaceFileAction(filePath: string): Promise<void> {
    const conn = await requireWorkspaceConnection()
    await engine.deleteFile(conn, engine.SHARED_FILES_BASE, filePath)
}

export async function renameWorkspaceFileAction(oldPath: string, newPath: string): Promise<void> {
    const conn = await requireWorkspaceConnection()
    await engine.moveFile(conn, engine.SHARED_FILES_BASE, oldPath, newPath)
}
