import { posix } from 'node:path'
import { deleteFile, listFiles, skillFilesBase } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { readTextFilePage } from '@/lib/files/text-page'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'
import { SKILL_ENTRY, isTextSkillFile } from './folder-import'

// A skill is a folder, and the engine only ever returns the paths of the files it bundles. These
// helpers put the rest of that folder within reach of a caller that has no filesystem: their size,
// their content one at a time, and their removal — all through the files router the engine already
// mounts on /agents/:id/skills/:slug/files.

export const MAX_SKILL_FILE_CHARS = TEXT_FILE_PAGE_CHARS

const MAX_LISTED_DIRECTORIES = 20

export type SkillFileInfo = { path: string; bytes?: number }

export type SkillFileContent = {
    path: string
    content: string
    offset: number
    nextOffset: number | null
    totalChars: number | null
    truncated: boolean
}

export function normalizeSkillFilePath(path: string): string {
    return path.replace(/^\.?\//, '').replace(/\/+$/, '')
}

function directoryOf(path: string): string {
    const cut = path.lastIndexOf('/')
    return cut === -1 ? '.' : path.slice(0, cut)
}

// One listing per distinct directory rather than one stat per file: a skill keeps its references
// side by side, so this is a call or two. A directory that fails to list costs the size of its
// files, never the listing itself.
export async function describeSkillFiles(conn: EngineConnection, agentId: string, slug: string, files: string[]): Promise<SkillFileInfo[]> {
    const base = skillFilesBase(agentId, slug)
    const directories = [...new Set(files.map(directoryOf))].slice(0, MAX_LISTED_DIRECTORIES)
    const sizes = new Map<string, number>()

    await Promise.all(
        directories.map(async directory => {
            const entries = await listFiles(conn, base, directory).catch(() => [])
            for (const entry of entries) {
                if (entry.type !== 'file') continue
                sizes.set(directory === '.' ? entry.name : `${directory}/${entry.name}`, entry.size)
            }
        })
    )

    return files.map(path => {
        const bytes = sizes.get(path)
        return bytes === undefined ? { path } : { path, bytes }
    })
}

export async function readSkillReferenceFile(conn: EngineConnection, agentId: string, slug: string, path: string, offset = 0): Promise<SkillFileContent> {
    const target = normalizeSkillFilePath(path)
    if (!target) throw new Error('Missing required argument: path')
    if (target === SKILL_ENTRY) throw new Error(`${SKILL_ENTRY} holds the skill body itself. Read it with get_skill.`)
    if (!isTextSkillFile(target)) throw new Error(`"${target}" is not a text file, so there is nothing to read here.`)
    if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.')

    try {
        return { path: target, ...(await readTextFilePage(conn, skillFilesBase(agentId, slug), target, offset)) }
    } catch (err) {
        // The engine answers a missing file with a bare 500 from the filesystem, so the reason a
        // read failed is worth stating as the caller can act on it rather than as a stack.
        const message = err instanceof Error ? err.message : 'unknown error'
        if (/failed: (404|500)/.test(message)) throw new Error(`No readable file "${target}" in skill "${slug}". Call get_skill to see the files it carries.`)
        throw new Error(`Could not read "${target}" in skill "${slug}": ${message}`)
    }
}

// Validation is separate from the deletions themselves so a caller can reject a bad path before
// touching the skill: upsert_skill writes the body first, and a removal refused after that swap
// would fail the call on a skill it had already changed.
export function planSkillFileRemovals(paths: string[]): string[] {
    const targets: string[] = []
    for (const target of paths.map(normalizeSkillFilePath).filter(Boolean)) {
        const resolved = posix.normalize(target)
        if (resolved === SKILL_ENTRY) throw new Error(`${SKILL_ENTRY} holds the skill body. Rewrite it with the body argument, or delete the whole skill.`)
        if (resolved === '.' || resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) throw new Error(`"${target}" is not a file of the skill. Name a reference file, e.g. references/old.md, or delete the whole skill.`)
        targets.push(resolved)
    }
    return targets
}

export async function removeSkillFiles(conn: EngineConnection, agentId: string, slug: string, paths: string[]): Promise<string[]> {
    const targets = planSkillFileRemovals(paths)
    const base = skillFilesBase(agentId, slug)
    for (const target of targets) await deleteFile(conn, base, target)
    return targets
}
