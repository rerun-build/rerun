import { stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { normalizeBrainTags, type BrainFileMeta, type BrainFilesMetaWrite } from '@rerun/contracts'
import { sharedDir } from '../config/paths.js'
import { getBrainDb } from '../db/brainDb.js'
import { nowIso } from '../lib/ids.js'
import { parseTags } from './pages.js'

// The shared folder is the Brain's files: brain_files only says how each one is filed (tags, who
// added it, its Box), keyed by its path in the folder.

// A path that climbs out of the shared folder, or names the folder itself, is no path of it: ''.
function sharedRelativePath(path: string): string {
    const rel = posix.normalize(path.replaceAll('\\', '/')).replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '')
    return rel === '.' || rel === '..' || rel.startsWith('../') ? '' : rel
}

// An import files its paths before their bytes land, so a row with no file yet may be an upload in
// flight. Only one that stayed empty a whole day is forgotten.
const ORPHAN_GRACE_MS = 24 * 60 * 60_000

const underClause = 'path = ? OR substr(path, 1, length(?) + 1) = ? || \'/\''

function toMeta(row: Record<string, unknown>, kind: BrainFileMeta['kind']): BrainFileMeta {
    return {
        path: String(row.path),
        kind,
        tags: parseTags(row.tags_json),
        createdBy: row.created_by == null ? null : String(row.created_by),
        spaceId: row.space_id == null ? null : String(row.space_id),
        createdAt: String(row.created_at),
    }
}

export async function listFileMeta(): Promise<BrainFileMeta[]> {
    const client = await getBrainDb()
    const rs = await client.execute('SELECT path, tags_json, created_by, space_id, created_at FROM brain_files ORDER BY path')
    const root = sharedDir()
    const kinds = await Promise.all(rs.rows.map(row => stat(join(root, String(row.path))).then(info => (info.isDirectory() ? 'dir' : 'file') as BrainFileMeta['kind'], () => null)))
    const present = rs.rows.flatMap((row, index) => {
        const kind = kinds[index]
        return kind ? [toMeta(row, kind)] : []
    })
    const orphans = rs.rows.filter((row, index) => !kinds[index] && Date.now() - Date.parse(String(row.created_at)) > ORPHAN_GRACE_MS).map(row => String(row.path))
    if (orphans.length) await client.batch(orphans.map(path => ({ sql: 'DELETE FROM brain_files WHERE path = ?', args: [path] })), 'write')
    return present
}

export async function setFileMeta({ paths, tags, spaceId, author }: BrainFilesMetaWrite): Promise<void> {
    const client = await getBrainDb()
    const tagsJson = tags === undefined ? null : JSON.stringify(normalizeBrainTags(tags))
    const createdAt = nowIso()
    const filed = [...new Set(paths.map(sharedRelativePath).filter(Boolean))]
    if (!filed.length) return
    await client.batch(
        filed.map(path => ({
            sql: `INSERT INTO brain_files(path, tags_json, created_by, space_id, created_at) VALUES (?, COALESCE(?, '[]'), ?, ?, ?)
                  ON CONFLICT(path) DO UPDATE SET
                      tags_json = COALESCE(?, brain_files.tags_json),
                      space_id = CASE WHEN ? THEN excluded.space_id ELSE brain_files.space_id END,
                      created_by = COALESCE(brain_files.created_by, excluded.created_by)`,
            args: [path, tagsJson, author ?? null, spaceId ?? null, createdAt, tagsJson, spaceId === undefined ? 0 : 1],
        })),
        'write'
    )
}

// A coworker that writes a file into the shared folder becomes its author, and the file is filed
// under its Box. A file that is already filed keeps what it had.
export async function recordFileCreated(path: string, author: string, spaceId: string | null): Promise<void> {
    const rel = sharedRelativePath(path)
    if (!rel) return
    const client = await getBrainDb()
    await client.execute({
        sql: "INSERT OR IGNORE INTO brain_files(path, tags_json, created_by, space_id, created_at) VALUES (?, '[]', ?, ?, ?)",
        args: [rel, author, spaceId, nowIso()],
    })
}

export async function moveFileMeta(from: string, to: string): Promise<void> {
    const source = sharedRelativePath(from)
    const target = sharedRelativePath(to)
    if (!source || !target || source === target) return
    const client = await getBrainDb()
    await client.execute({
        sql: `UPDATE OR REPLACE brain_files SET path = ? || substr(path, length(?) + 1) WHERE ${underClause}`,
        args: [target, source, source, source, source],
    })
}

export async function removeFileMeta(path: string): Promise<void> {
    const rel = sharedRelativePath(path)
    if (!rel) return
    const client = await getBrainDb()
    await client.execute({ sql: `DELETE FROM brain_files WHERE ${underClause}`, args: [rel, rel, rel] })
}

export async function reattributeFiles(fromAuthor: string, toAuthor: string): Promise<void> {
    const client = await getBrainDb()
    await client.execute({ sql: 'UPDATE brain_files SET created_by = ? WHERE created_by = ?', args: [toAuthor, fromAuthor] })
}

export const sharedFileMetaHooks = { moved: moveFileMeta, removed: removeFileMeta }
