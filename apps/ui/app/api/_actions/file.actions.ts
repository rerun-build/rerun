'use server'

import { resolveAgentTarget, resolveRunTarget } from '@/app/api/_services/chat.service'
import { saveTextFile, type SaveFileResult } from '@/app/api/_services/file.service'
import * as engine from '@/lib/engine/client'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'

export type FileEntry = {
    name: string
    type: 'file' | 'dir' | 'symlink'
    size: number
    modified: string
}

export async function listFilesAction(agentId: string, relativePath = '', showHidden = false): Promise<{ entries: FileEntry[]; path: string }> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId)
    const entries = await engine.listFiles(conn, `/agents/${engineAgentId}/files`, relativePath || '.')
    const mapped: FileEntry[] = entries
        .filter(e => showHidden || !e.name.startsWith('.'))
        .map(e => ({ name: e.name, type: e.type, size: e.size, modified: '' }))
    return { entries: mapped, path: relativePath }
}

export async function readFileAction(agentId: string, filePath: string): Promise<{ content: string; truncated: boolean }> {
    const { conn, engineAgentId } = await resolveRunTarget(agentId)
    const page = await engine.readFileText(conn, `/agents/${engineAgentId}/files`, filePath)
    return { content: page.content, truncated: page.truncated ?? page.content.length >= TEXT_FILE_PAGE_CHARS }
}

export async function writeFileAction(agentId: string, filePath: string, content: string, baseHash: string | null): Promise<SaveFileResult> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId)
    return saveTextFile(conn, `/agents/${engineAgentId}/files`, filePath, content, baseHash)
}

// Thumbnails only need the first few lines. Slicing here keeps the browser payload tiny even
// though the engine hands us a 100k page.
export async function readFileHeadAction(agentId: string, filePath: string): Promise<string> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId)
    const { content } = await engine.readFileText(conn, `/agents/${engineAgentId}/files`, filePath)
    return content.slice(0, 600)
}

export async function deleteFileAction(agentId: string, filePath: string): Promise<void> {
    const { conn, engineAgentId } = await resolveRunTarget(agentId)
    await engine.deleteFile(conn, `/agents/${engineAgentId}/files`, filePath)
}

export async function renameFileAction(agentId: string, oldPath: string, newPath: string): Promise<void> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId)
    await engine.moveFile(conn, `/agents/${engineAgentId}/files`, oldPath, newPath)
}
