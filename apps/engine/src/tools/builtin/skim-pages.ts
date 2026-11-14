import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { renderTextToImages } from 'pxpipe-proxy/transform'
import { z } from 'zod'
import { workspaceDir } from '../../config/paths.js'
import { createScreenshotStore } from '../../runtime/screenshots.js'
import type { RunContext } from '../../runtime/context.js'
import type { LoadedAgent } from '../../agents/types.js'
import { resolveWithinReal } from '../sandbox.js'

const MAX_TEXT_BYTES = 2_000_000
const MAX_EXACT = 100
const SKIPPED_DIRS = new Set(['node_modules', '.git'])
export const SKIM_NOTE = 'A page is good for an overview and can be wrong about one random value in four without saying so. Read the file for any exact value.'

export function skimPagesEnabled(agent: LoadedAgent): boolean {
    return agent.config.pages?.skim === true
}

const KEY_FILE = /^(\.env.*|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*)$/i
const KEY_SEGMENT = /secret|token/i

export function refusedKeyPath(rel: string): boolean {
    return rel.split(/[\\/]+/).some(seg => seg !== '' && (KEY_FILE.test(seg) || KEY_SEGMENT.test(seg)))
}

export function exactValues(text: string): { ids: string[]; numbers: string[] } {
    const ids = new Set<string>()
    for (const m of text.matchAll(/[A-Za-z0-9_-]{8,64}/g)) {
        if (/[A-Za-z]/.test(m[0]) && /\d/.test(m[0]) && !/^[A-Za-z0-9_-]{65,}$/.test(m[0])) ids.add(m[0])
        if (ids.size >= MAX_EXACT) break
    }
    return { ids: [...ids], numbers: [...new Set(text.match(/\d{4,}/g) ?? [])].slice(0, MAX_EXACT) }
}

async function walk(dir: string, root: string, lines: string[], files: string[]): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
        const full = join(dir, e.name)
        const rel = relative(root, full).split(sep).join('/')
        if (e.isDirectory()) {
            if (SKIPPED_DIRS.has(e.name) || refusedKeyPath(e.name)) continue
            lines.push(`${rel}/`)
            await walk(full, root, lines, files)
        } else if (e.isFile() && !refusedKeyPath(e.name)) {
            lines.push(rel)
            files.push(full)
        }
    }
}

async function folderText(dir: string): Promise<{ tree: string; text: string }> {
    const lines: string[] = []
    const files: string[] = []
    await walk(dir, dir, lines, files)
    const shown: string[] = []
    let bytes = 0
    for (const file of files) {
        const buf = await readFile(file)
        if (buf.includes(0)) continue
        if (bytes + buf.length > MAX_TEXT_BYTES) break
        bytes += buf.length
        shown.push(`=== ${relative(dir, file).split(sep).join('/')} ===\n${buf.toString('utf8')}`)
    }
    const tree = lines.join('\n')
    return { tree, text: [tree, ...shown].join('\n\n') }
}

export function skimPagesTools(ctx: RunContext): ToolSet {
    const root = workspaceDir(ctx.agent.id)
    return {
        skim_pages: tool({
            description: 'Skim a file or folder of your workspace as one picture of text per call (a diff or a log is a file). Good for an overview; returns the ids and numbers it found in the text, extracted by code. Read the file for any exact value.',
            inputSchema: z.object({ path: z.string().describe('File or folder in your workspace'), page: z.number().int().optional().describe('Page, from 1') }),
            execute: async ({ path, page = 1 }) => {
                if (refusedKeyPath(path)) throw new Error(`skim_pages does not render key material: ${path}`)
                const full = await resolveWithinReal(root, path)
                const rel = relative(root, full)
                if (rel !== '' && refusedKeyPath(rel)) throw new Error(`skim_pages does not render key material: ${path}`)
                const info = await stat(full)
                let text: string
                let tree: string | undefined
                if (info.isDirectory()) {
                    ;({ tree, text } = await folderText(full))
                } else {
                    if (info.size > MAX_TEXT_BYTES) throw new Error(`${basename(full)} is over ${MAX_TEXT_BYTES} bytes`)
                    const buf = await readFile(full)
                    if (buf.includes(0)) throw new Error(`${basename(full)} is not a text file`)
                    text = buf.toString('utf8')
                }
                const { pages } = await renderTextToImages(text)
                if (!Number.isInteger(page) || page < 1 || page > pages.length) throw new Error(`page must be from 1 to ${pages.length}, got ${page}`)
                ctx.screenshots ??= createScreenshotStore()
                const screenshotId = ctx.screenshots.add({ image: Buffer.from(pages[page - 1]!.png), mediaType: 'image/png' })
                const perPage = Math.ceil(text.length / pages.length)
                const exact = exactValues(text.slice((page - 1) * perPage, page * perPage))
                return { screenshotId, page, pages: pages.length, exact, ...(tree === undefined ? {} : { tree }), note: SKIM_NOTE }
            },
        }),
    }
}
