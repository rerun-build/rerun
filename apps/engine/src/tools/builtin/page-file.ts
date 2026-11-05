import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { resolveInWorkspace } from '../sandbox.js'

// Every page a coworker reads is kept whole in its workspace, next to the other reads of the same
// URL: what a tool result leaves out stays one grep away, and served and rendered HTML can be
// diffed. Kept out of any capture or share of the agent, like the paid answers.
export const PAGES_DIR = '.rerun/pages'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_SEGMENT_CHARS = 80
// Pruning walks and stats the whole folder: once per process for an agent, then one read in twenty.
const PRUNE_EVERY = 20

const savesSincePrune = new Map<string, number>()

export type PageView = 'served' | 'rendered' | 'browser'

type ViewMeta = { file: string; savedAt: string; status?: number; finalUrl?: string; contentType?: string; xRobotsTag?: string }
type PageMeta = { url: string; views: Partial<Record<PageView, ViewMeta>> }

export type PageToSave = {
    url: string
    view: PageView
    body: string
    ext: string
    status?: number
    finalUrl?: string | null
    contentType?: string | null
    xRobotsTag?: string | null
}

const fileSafe = (text: string): string => text.replace(/[^\w.-]/g, '_')
const shortHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 8)

// null for a body worth no grep (an image, a PDF): the download tool is there for those.
export function textExtension(contentType: string | null): string | null {
    const type = (contentType ?? '').toLowerCase()
    if (!type) return 'txt'
    if (type.includes('html')) return 'html'
    if (type.includes('xml') || type.includes('rss') || type.includes('atom')) return 'xml'
    if (type.includes('json')) return 'json'
    if (type.includes('markdown')) return 'md'
    if (type.includes('javascript')) return 'js'
    if (type.startsWith('text/')) return 'txt'
    return null
}

// The path of the URL, mirrored: /blog/post lands in <host>/blog/post, / and /blog/ end in index.
// A segment that cannot be kept as is, or a query, gets the hash of the whole URL so two URLs
// never share a file.
export function pageFileBase(url: string): string {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').slice(1)
    if (segments.at(-1) === '') segments[segments.length - 1] = 'index'
    const safe = segments.map(segment => (/^\.*$/.test(segment) ? '_' : fileSafe(segment).slice(0, MAX_SEGMENT_CHARS)))
    const lossy = !!parsed.search || safe.some((segment, i) => segment !== segments[i])
    if (lossy) safe[safe.length - 1] = `${safe.at(-1)}-${shortHash(parsed.pathname + parsed.search)}`
    return [fileSafe(parsed.host), ...safe].join('/')
}

async function readMeta(path: string): Promise<PageMeta | null> {
    try {
        return JSON.parse(await readFile(path, 'utf8')) as PageMeta
    } catch {
        return null
    }
}

// Best effort: a full disk or an unwritable workspace leaves the page read, only unsaved.
export async function savePage(agentId: string, page: PageToSave): Promise<string | null> {
    try {
        const root = await resolveInWorkspace(agentId, PAGES_DIR)
        let base = pageFileBase(page.url)
        let meta = await readMeta(join(root, `${base}.meta.json`))
        if (meta && meta.url !== page.url) {
            base = `${base}-${shortHash(page.url)}`
            meta = await readMeta(join(root, `${base}.meta.json`))
        }
        const file = `${base}.${page.view}.${page.ext}`
        const metaFile = `${base}.meta.json`
        await mkdir(dirname(join(root, file)), { recursive: true })
        await writeFile(join(root, file), page.body)
        const view: ViewMeta = {
            file: `${PAGES_DIR}/${file}`,
            savedAt: new Date().toISOString(),
            ...(page.status !== undefined ? { status: page.status } : {}),
            ...(page.finalUrl && page.finalUrl !== page.url ? { finalUrl: page.finalUrl } : {}),
            ...(page.contentType ? { contentType: page.contentType } : {}),
            ...(page.xRobotsTag ? { xRobotsTag: page.xRobotsTag } : {}),
        }
        await writeFile(join(root, metaFile), JSON.stringify({ url: page.url, views: { ...meta?.views, [page.view]: view } }, null, 2))
        const saves = ((savesSincePrune.get(agentId) ?? 0) + 1) % PRUNE_EVERY
        savesSincePrune.set(agentId, saves)
        if (saves === 1) await prunePages(root, new Set([file, metaFile]))
        return `${PAGES_DIR}/${file}`
    } catch {
        return null
    }
}

async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(entries.map(entry => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)])))
    return nested.flat()
}

async function removeEmptyParents(root: string, path: string): Promise<void> {
    for (let dir = dirname(path); dir !== root && dir.startsWith(root); dir = dirname(dir)) {
        if (!(await rmdir(dir).then(() => true, () => false))) return
    }
}

async function prunePages(root: string, keep: Set<string>): Promise<void> {
    const files = await Promise.all(
        (await filesUnder(root)).filter(path => !keep.has(relative(root, path))).map(async path => ({ path, ...(await stat(path)) })),
    )
    const now = Date.now()
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (now - file.mtimeMs <= MAX_AGE_MS && total <= MAX_TOTAL_BYTES) break
        await unlink(file.path).catch(() => undefined)
        total -= file.size
        await removeEmptyParents(root, file.path)
    }
}
