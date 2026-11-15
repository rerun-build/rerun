import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { BRAIN_CARD_TYPES, BRAIN_SLUG_RE, brainPageTypeSchema, type BrainPage, type BrainPageRef, type BrainPageSummary, type BrainPageType, type BrainRevision } from '@rerun/contracts'
import { brainDir, brainPagePath } from '../config/paths.js'
import { getBrainDb } from '../db/brainDb.js'
import { badRequest, HttpError, notFound } from '../lib/errors.js'
import { newId, nowIso } from '../lib/ids.js'
import { chunkPage, pageSections, textHash } from './chunks.js'
import { parseLinks } from './links.js'
import { scheduleBrainEmbedding } from './embedding.js'

export type BrainPageFile = BrainPageSummary & { content: string; sources: string[]; unconfirmed: string[] }

export const SEED_AUTHOR = 'seed'

export type PageInput = { title: string; type: BrainPageType; content: string; sources: string[] }

export type WritePageInput = PageInput & {
    author: string
    baseHash: string | null
    force?: boolean
    proposalId?: string | null
    unconfirmed?: string[]
    separateRevision?: boolean
}

export const brainConflict = (message: string) => new HttpError(409, message)

export const pageHash = (page: { title: string; type: string; content: string }) => textHash(`${page.title.trim()}\n${page.type}\n${page.content.trim()}`)

const sectionHeadings = (content: string) => [...new Set(pageSections(content).map(section => section.heading))]

export const seedOwnsPage = (page: BrainPageFile) => page.updatedBy === SEED_AUTHOR && page.unconfirmed.length === sectionHeadings(page.content).length

const sectionWords = (body: string) => body.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function unconfirmedAfterWrite(current: BrainPageFile | null, content: string, author: string): string[] {
    if (author === SEED_AUTHOR) return sectionHeadings(content)
    if (!current?.unconfirmed.length) return []
    const before = new Map(pageSections(current.content).map(section => [section.heading, sectionWords(section.body)]))
    const kept = pageSections(content).filter(section => current.unconfirmed.includes(section.heading) && before.get(section.heading) === sectionWords(section.body))
    return [...new Set(kept.map(section => section.heading))]
}

function asString(value: unknown): string | null {
    if (typeof value === 'string') return value
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
    return null
}

function parsePage(slug: string, raw: string): BrainPageFile {
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const type = brainPageTypeSchema.safeParse(data.type)
    const content = parsed.content.trim()
    const updatedBy = asString(data.updatedBy) ?? 'user'
    const headings = sectionHeadings(content)
    const unconfirmed = Array.isArray(data.unconfirmed) ? data.unconfirmed.map(String).filter(heading => headings.includes(heading)) : updatedBy === SEED_AUTHOR ? headings : []
    const page = {
        slug,
        title: asString(data.title)?.trim() || slug,
        type: type.success ? type.data : ('note' as const),
        content,
        sources: Array.isArray(data.sources) ? data.sources.map(String) : [],
        updatedAt: asString(data.updatedAt) ?? '',
        updatedBy,
        unconfirmed,
    }
    return { ...page, hash: pageHash(page) }
}

export async function readPageFile(slug: string): Promise<BrainPageFile | null> {
    if (!BRAIN_SLUG_RE.test(slug)) return null
    const path = brainPagePath(slug)
    if (!existsSync(path)) return null
    return parsePage(slug, await readFile(path, 'utf8'))
}

export async function listPageFiles(): Promise<BrainPageFile[]> {
    if (!existsSync(brainDir())) return []
    const entries = await readdir(brainDir(), { withFileTypes: true })
    const slugs = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
    const pages = await Promise.all(slugs.filter(s => BRAIN_SLUG_RE.test(s)).map(readPageFile))
    return pages.filter((p): p is BrainPageFile => p !== null)
}

async function writePageFile(page: BrainPageFile): Promise<void> {
    await mkdir(brainDir(), { recursive: true })
    const path = brainPagePath(page.slug)
    const tmp = `${path}.${newId()}.tmp`
    const body = matter.stringify(`\n${page.content}\n`, {
        title: page.title,
        type: page.type,
        updatedAt: page.updatedAt,
        updatedBy: page.updatedBy,
        sources: page.sources,
        unconfirmed: page.unconfirmed,
    })
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, path)
}

const locks = new Map<string, Promise<unknown>>()

async function withPageLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(slug) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(fn)
    locks.set(slug, run)
    try {
        return await run
    } finally {
        if (locks.get(slug) === run) locks.delete(slug)
    }
}

export async function indexPage(page: BrainPageFile): Promise<void> {
    const client = await getBrainDb()
    const chunks = chunkPage(page)
    const old = await client.execute({ sql: 'SELECT id, text_hash FROM brain_chunks WHERE slug = ?', args: [page.slug] })
    const reusable = new Map<string, string[]>()
    for (const row of old.rows) {
        const hash = String(row.text_hash)
        reusable.set(hash, [...(reusable.get(hash) ?? []), String(row.id)])
    }

    const statements: { sql: string; args: (string | number)[] }[] = []
    for (const chunk of chunks) {
        const kept = reusable.get(chunk.textHash)?.shift()
        if (kept) {
            statements.push({ sql: 'UPDATE brain_chunks SET heading = ?, ordinal = ? WHERE id = ?', args: [chunk.heading, chunk.ordinal, kept] })
            continue
        }
        const id = newId()
        statements.push({
            sql: 'INSERT INTO brain_chunks(id, slug, heading, ordinal, content, text_hash) VALUES (?, ?, ?, ?, ?, ?)',
            args: [id, page.slug, chunk.heading, chunk.ordinal, chunk.content, chunk.textHash],
        })
        statements.push({ sql: 'INSERT INTO brain_chunks_fts(content, chunk_id) VALUES (?, ?)', args: [chunk.text, id] })
    }
    for (const id of [...reusable.values()].flat()) {
        statements.push({ sql: 'DELETE FROM brain_chunks_fts WHERE chunk_id = ?', args: [id] })
        statements.push({ sql: 'DELETE FROM brain_chunks WHERE id = ?', args: [id] })
    }

    statements.push({ sql: 'DELETE FROM brain_links WHERE from_slug = ?', args: [page.slug] })
    for (const target of parseLinks(page.content, page.slug)) {
        statements.push({ sql: 'INSERT OR IGNORE INTO brain_links(from_slug, to_slug) VALUES (?, ?)', args: [page.slug, target] })
    }
    statements.push({
        sql: `INSERT INTO brain_pages(slug, title, type, hash, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(slug) DO UPDATE SET title = excluded.title, type = excluded.type, hash = excluded.hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        args: [page.slug, page.title, page.type, page.hash, page.updatedAt, page.updatedBy],
    })
    await client.batch(statements, 'write')
}

export async function unindexPage(slug: string): Promise<void> {
    const client = await getBrainDb()
    await client.batch(
        [
            { sql: 'DELETE FROM brain_chunks_fts WHERE chunk_id IN (SELECT id FROM brain_chunks WHERE slug = ?)', args: [slug] },
            { sql: 'DELETE FROM brain_chunks WHERE slug = ?', args: [slug] },
            { sql: 'DELETE FROM brain_links WHERE from_slug = ?', args: [slug] },
            { sql: 'DELETE FROM brain_pages WHERE slug = ?', args: [slug] },
        ],
        'write'
    )
}

const REVISION_MERGE_WINDOW_MS = 10 * 60_000

async function recordRevision(page: BrainPageFile, proposalId: string | null, force: boolean): Promise<void> {
    const client = await getBrainDb()
    if (!force && !proposalId) {
        const rs = await client.execute({
            sql: 'SELECT id, author, proposal_id, created_at FROM brain_revisions WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
            args: [page.slug],
        })
        const last = rs.rows[0]
        const recent = last && Date.parse(page.updatedAt) - Date.parse(String(last.created_at)) < REVISION_MERGE_WINDOW_MS
        if (last && recent && last.proposal_id == null && String(last.author) === page.updatedBy) {
            await client.execute({
                sql: 'UPDATE brain_revisions SET title = ?, content = ?, hash = ?, created_at = ? WHERE id = ?',
                args: [page.title, page.content, page.hash, page.updatedAt, String(last.id)],
            })
            return
        }
    }
    await client.execute({
        sql: 'INSERT INTO brain_revisions(id, slug, title, content, hash, author, proposal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [newId(), page.slug, page.title, page.content, page.hash, page.updatedBy, proposalId, page.updatedAt],
    })
}

export async function writePage(slug: string, input: WritePageInput): Promise<BrainPageFile> {
    if (!BRAIN_SLUG_RE.test(slug)) throw badRequest(`Invalid page slug "${slug}": use lowercase kebab-case.`)
    return withPageLock(slug, async () => {
        const current = await readPageFile(slug)
        if (!input.force) {
            if (current && input.baseHash !== current.hash) throw brainConflict(`The page "${slug}" changed since it was read. Reload it and apply the change again.`)
            if (!current && input.baseHash) throw brainConflict(`The page "${slug}" no longer exists.`)
        }
        const fields = { title: input.title.trim(), type: input.type, content: input.content.trim(), sources: input.sources }
        const hash = pageHash(fields)
        if (current && current.hash === hash && current.sources.join('\n') === fields.sources.join('\n')) return current

        const page: BrainPageFile = { slug, ...fields, hash, updatedAt: nowIso(), updatedBy: input.author, unconfirmed: input.unconfirmed ?? unconfirmedAfterWrite(current, fields.content, input.author) }
        await writePageFile(page)
        await indexPage(page)
        await recordRevision(page, input.proposalId ?? null, (input.force ?? false) || (input.separateRevision ?? false))
        scheduleBrainEmbedding()
        return page
    })
}

export async function confirmSections(slug: string, headings: string[] | null): Promise<BrainPageFile> {
    return withPageLock(slug, async () => {
        const current = await readPageFile(slug)
        if (!current) throw notFound('page')
        const unconfirmed = headings ? current.unconfirmed.filter(heading => !headings.includes(heading)) : []
        if (unconfirmed.length === current.unconfirmed.length) return current
        const page = { ...current, unconfirmed }
        await writePageFile(page)
        return page
    })
}

export async function reattributePages(fromAuthor: string, toAuthor: string): Promise<void> {
    for (const { slug } of (await listPageFiles()).filter(page => page.updatedBy === fromAuthor)) {
        await withPageLock(slug, async () => {
            const current = await readPageFile(slug)
            if (!current || current.updatedBy !== fromAuthor) return
            await writePageFile({ ...current, updatedBy: toAuthor })
            const client = await getBrainDb()
            await client.execute({ sql: 'UPDATE brain_pages SET updated_by = ? WHERE slug = ?', args: [toAuthor, slug] })
        })
    }
}

export async function deletePage(slug: string): Promise<void> {
    await withPageLock(slug, async () => {
        if (!(await readPageFile(slug))) throw notFound('page')
        await rm(brainPagePath(slug), { force: true })
        await unindexPage(slug)
    })
}

const CARD_ORDER = new Map<string, number>(BRAIN_CARD_TYPES.map((t, i) => [t, i]))

export function sortPages<T extends { type: string; title: string }>(pages: T[]): T[] {
    return [...pages].sort((a, b) => {
        const ca = CARD_ORDER.get(a.type) ?? CARD_ORDER.size
        const cb = CARD_ORDER.get(b.type) ?? CARD_ORDER.size
        return ca - cb || a.title.localeCompare(b.title)
    })
}

export async function listPages(): Promise<BrainPageSummary[]> {
    const client = await getBrainDb()
    const rs = await client.execute('SELECT slug, title, type, hash, updated_at, updated_by FROM brain_pages')
    return sortPages(
        rs.rows.map(r => ({
            slug: String(r.slug),
            title: String(r.title),
            type: r.type as BrainPageType,
            hash: String(r.hash),
            updatedAt: String(r.updated_at),
            updatedBy: String(r.updated_by),
        }))
    )
}

export async function backlinks(slug: string): Promise<BrainPageRef[]> {
    const client = await getBrainDb()
    const rs = await client.execute({
        sql: 'SELECT l.from_slug AS slug, p.title AS title FROM brain_links l JOIN brain_pages p ON p.slug = l.from_slug WHERE l.to_slug = ? ORDER BY p.title',
        args: [slug],
    })
    return rs.rows.map(r => ({ slug: String(r.slug), title: String(r.title) }))
}

export async function getPage(slug: string): Promise<BrainPage | null> {
    const file = await readPageFile(slug)
    if (!file) return null
    return { ...file, links: parseLinks(file.content, slug), backlinks: await backlinks(slug) }
}

function toRevision(r: Record<string, unknown>): BrainRevision {
    return {
        id: String(r.id),
        slug: String(r.slug),
        title: String(r.title),
        hash: String(r.hash),
        author: String(r.author),
        proposalId: r.proposal_id == null ? null : String(r.proposal_id),
        createdAt: String(r.created_at),
    }
}

export async function listRevisions(slug: string, limit = 50): Promise<BrainRevision[]> {
    const client = await getBrainDb()
    const rs = await client.execute({
        sql: 'SELECT id, slug, title, hash, author, proposal_id, created_at FROM brain_revisions WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        args: [slug, limit],
    })
    return rs.rows.map(toRevision)
}

export async function getRevision(slug: string, id: string): Promise<{ revision: BrainRevision; content: string } | null> {
    const client = await getBrainDb()
    const rs = await client.execute({ sql: 'SELECT * FROM brain_revisions WHERE slug = ? AND id = ?', args: [slug, id] })
    const row = rs.rows[0]
    if (!row) return null
    return { revision: toRevision(row), content: String(row.content) }
}

export async function revertPage(slug: string, revisionId: string, author: string, expectedHash?: string): Promise<BrainPageFile> {
    const found = await getRevision(slug, revisionId)
    if (!found) throw notFound('revision')
    const current = await readPageFile(slug)
    return writePage(slug, {
        title: found.revision.title,
        type: current?.type ?? 'note',
        content: found.content,
        sources: current?.sources ?? [],
        baseHash: expectedHash ?? null,
        force: expectedHash === undefined,
        author,
        unconfirmed: found.revision.author === SEED_AUTHOR ? sectionHeadings(found.content) : undefined,
    })
}
