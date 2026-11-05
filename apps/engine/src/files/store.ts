import { readFile, writeFile, mkdir, readdir, rm, rename, chmod, stat as fsStat, lstat } from 'node:fs/promises'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'
import { badRequest } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { capAt } from '../lib/stream.js'
import { resolveWithinReal } from '../tools/sandbox.js'

export type FileEntry = {
    name: string
    type: 'file' | 'dir'
    size: number
    modifiedAt: string
}

export type TextPage = {
    content: string
    offset: number
    nextOffset: number | null
    totalChars: number
    truncated: boolean
}

const IGNORED_DIRS = new Set(['node_modules', '.git'])

export async function listEntries(root: string, rel: string): Promise<FileEntry[]> {
    const target = await resolveWithinReal(root, rel)
    if (!existsSync(target)) return []
    const entries = await readdir(target, { withFileTypes: true })
    const out: FileEntry[] = []
    for (const entry of entries) {
        const info = await fsStat(join(target, entry.name))
        out.push({
            name: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
        })
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
}

export async function readText(root: string, rel: string): Promise<string> {
    return readFile(await resolveWithinReal(root, rel), 'utf8')
}

export function paginateText(content: string, offset: number): TextPage {
    const page = content.slice(offset, offset + TEXT_FILE_PAGE_CHARS)
    const end = offset + page.length
    const nextOffset = end < content.length ? end : null
    return { content: page, offset, nextOffset, totalChars: content.length, truncated: nextOffset !== null }
}

export type ByteRange = { start: number; end: number }

export async function fileSize(root: string, rel: string): Promise<number> {
    const info = await fsStat(await resolveWithinReal(root, rel))
    if (!info.isFile()) throw badRequest(`"${rel}" is not a file`)
    return info.size
}

// Streamed rather than read whole: a video sent to the chat can weigh more than a 512 MB Box can hold.
export async function readByteStream(root: string, rel: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    return Readable.toWeb(createReadStream(await resolveWithinReal(root, rel), range)) as ReadableStream<Uint8Array>
}

// Written through a temp file for the same reason as `writeStream`: a disk that fills up mid-write
// would otherwise leave a half-written file behind. A symlink is written through directly, since
// renaming over it would replace the link instead of its target.
export async function writeText(root: string, rel: string, content: string): Promise<void> {
    const target = await resolveWithinReal(root, rel)
    await mkdir(dirname(target), { recursive: true })

    const existing = await lstat(target).catch(() => null)
    if (existing?.isSymbolicLink()) {
        await writeFile(target, content, 'utf8')
        return
    }

    const temp = `${target}.part-${newId().slice(0, 8)}`
    try {
        await writeFile(temp, content, 'utf8')
        if (existing) await chmod(temp, existing.mode)
        await rename(temp, target)
    } catch (err) {
        await rm(temp, { force: true })
        throw err
    }
}

export async function writeBytes(root: string, rel: string, data: Uint8Array): Promise<void> {
    const target = await resolveWithinReal(root, rel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
}

// Written through a temp file rather than straight to `target`: an upload that is cut off midway,
// or refused by the cap, would otherwise leave a truncated file that an agent reads as a whole one.
export async function writeStream(root: string, rel: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
    const target = await resolveWithinReal(root, rel)
    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.part-${newId().slice(0, 8)}`

    let bytes = 0
    const count = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.byteLength
            callback(null, chunk)
        },
    })

    try {
        await pipeline(
            Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
            capAt(maxBytes, max => `This file is larger than the ${max / 1024 / 1024} MB upload limit.`),
            count,
            createWriteStream(temp),
        )
        await rename(temp, target)
        return bytes
    } catch (err) {
        await rm(temp, { force: true })
        throw err
    }
}

// `.`, `a/..` and the absolute root all resolve to the root itself, which `resolveWithinReal` lets
// through. The link itself is what gets removed or moved, never what it points to.
async function resolveBelow(root: string, rel: string, action: string): Promise<string> {
    const target = await resolveWithinReal(root, rel, { followLast: false })
    if (relative(root, target) === '') throw badRequest(`The root folder cannot be ${action}`)
    return target
}

export async function remove(root: string, rel: string): Promise<void> {
    await rm(await resolveBelow(root, rel, 'deleted'), { recursive: true, force: true })
}

export async function move(root: string, from: string, to: string): Promise<void> {
    const source = await resolveBelow(root, from, 'moved')
    const target = await resolveWithinReal(root, to, { followLast: false })
    await mkdir(dirname(target), { recursive: true })
    await rename(source, target)
}

export async function ensureDir(root: string, rel: string): Promise<void> {
    await mkdir(await resolveWithinReal(root, rel), { recursive: true })
}

export async function stat(root: string, rel: string): Promise<FileEntry> {
    const target = await resolveWithinReal(root, rel)
    const info = await fsStat(target)
    return {
        name: rel.split('/').pop() ?? rel,
        type: info.isDirectory() ? 'dir' : 'file',
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
    }
}

async function walkFiles(dir: string, out: string[], limit: number): Promise<void> {
    if (out.length >= limit) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        if (out.length >= limit) return
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue
            await walkFiles(join(dir, entry.name), out, limit)
        } else if (entry.isFile()) {
            out.push(join(dir, entry.name))
        }
    }
}

export async function searchText(root: string, rel: string, pattern: string, maxResults: number): Promise<string[]> {
    const regex = new RegExp(pattern)
    const start = await resolveWithinReal(root, rel)
    if (!existsSync(start)) return []
    const files: string[] = []
    await walkFiles(start, files, 20_000)
    const hits: string[] = []
    for (const file of files) {
        if (hits.length >= maxResults) break
        let text: string
        try {
            text = await readFile(file, 'utf8')
        } catch {
            continue
        }
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
            if (hits.length >= maxResults) break
            if (regex.test(lines[i])) hits.push(`${relative(root, file)}:${i + 1}: ${lines[i].trim().slice(0, 300)}`)
        }
    }
    return hits
}
