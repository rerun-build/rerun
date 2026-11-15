import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { resolveInWorkspace } from '../sandbox.js'

export const PAID_ANSWERS_DIR = '.rerun/paid-data'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const READ_BUDGET = 38_000

export type FullPaidAnswer = { output: unknown; raw: unknown; notes?: unknown; rawDropped?: boolean }

type SavedPaidAnswer = { capability: string; params: Record<string, unknown>; callId: string; savedAt: string } & FullPaidAnswer

const fileSafe = (text: string): string => text.replace(/[^\w.-]/g, '_').slice(0, 80)

export async function savePaidAnswer(agentId: string, answer: Omit<SavedPaidAnswer, 'savedAt'>): Promise<string | null> {
    try {
        const dir = await resolveInWorkspace(agentId, PAID_ANSWERS_DIR)
        await mkdir(dir, { recursive: true })
        const savedAt = new Date().toISOString()
        const name = `${fileSafe(answer.capability)}-${savedAt.slice(0, 10)}-${fileSafe(answer.callId)}.json`
        const { output, raw, notes, rawDropped, ...meta } = answer
        await writeFile(join(dir, name), JSON.stringify({ ...meta, savedAt, notes, output, raw, ...(rawDropped ? { rawDropped } : {}) }, null, 2))
        await prunePaidAnswers(dir, name)
        return `${PAID_ANSWERS_DIR}/${name}`
    } catch {
        return null
    }
}

async function prunePaidAnswers(dir: string, keep: string): Promise<void> {
    const files = await Promise.all(
        (await readdir(dir)).filter(name => name.endsWith('.json') && name !== keep).map(async name => ({ name, ...(await stat(join(dir, name))) })),
    )
    const now = Date.now()
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (now - file.mtimeMs <= MAX_AGE_MS && total <= MAX_TOTAL_BYTES) break
        await unlink(join(dir, file.name)).catch(() => undefined)
        total -= file.size
    }
}

export type PaidAnswerRead = { saved: string; path: string; value?: unknown; outline?: unknown; total?: number; offset?: number; next?: number; note?: string }

const sizeOf = (value: unknown): number => JSON.stringify(value)?.length ?? 0

function describe(value: unknown): string {
    if (Array.isArray(value)) return `list of ${value.length}, ${sizeOf(value)} chars`
    if (value && typeof value === 'object') return `object, ${sizeOf(value)} chars`
    return typeof value === 'string' ? `text, ${value.length} chars` : JSON.stringify(value)
}

function outlineTo(value: unknown, depth: number): unknown {
    if (depth === 0 || !value || typeof value !== 'object') return describe(value)
    if (Array.isArray(value)) return value.length > 0 && typeof value[0] === 'object' ? { [describe(value)]: outlineTo(value[0], depth - 1) } : describe(value)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, outlineTo(child, depth - 1)]))
}

export function outlineOf(value: unknown): unknown {
    for (let depth = 5; depth > 1; depth--) {
        const outline = outlineTo(value, depth)
        if (sizeOf(outline) <= READ_BUDGET) return outline
    }
    return outlineTo(value, 1)
}

function at(value: unknown, path: string): unknown {
    let node = value
    for (const key of path.split('.').filter(Boolean)) {
        if (node === null || typeof node !== 'object') return undefined
        node = (node as Record<string, unknown>)[key]
    }
    return node
}

export async function readPaidAnswer(agentId: string, saved: string, path = '', offset = 0, limit?: number): Promise<PaidAnswerRead> {
    const name = saved.slice(PAID_ANSWERS_DIR.length + 1)
    if (!saved.startsWith(`${PAID_ANSWERS_DIR}/`) || name !== basename(name) || name.startsWith('.')) throw new Error(`Not a saved paid answer: ${saved}. Pass the "saved" path a paid_data result gave.`)
    let answer: unknown
    try {
        answer = JSON.parse(await readFile(await resolveInWorkspace(agentId, saved), 'utf8'))
    } catch {
        throw new Error(`No saved paid answer at ${saved}: it may be older than 30 days.`)
    }
    const value = at(answer, path)
    if (value === undefined) return { saved, path, outline: outlineOf(answer), note: `Nothing at "${path}". The outline shows the keys there are.` }

    if (Array.isArray(value)) {
        const end = limit === undefined ? value.length : Math.min(value.length, offset + limit)
        if (offset < end && sizeOf(value[offset]) > READ_BUDGET) {
            return { saved, path, outline: outlineOf(value[offset]), total: value.length, offset, next: offset + 1, note: `Item ${offset} of "${path}" is too big to read at once: read a key of it with path "${path}.${offset}.<key>".` }
        }
        const items: unknown[] = []
        let size = 0
        for (let index = offset; index < end; index++) {
            size += sizeOf(value[index]) + 1
            if (items.length > 0 && size > READ_BUDGET) break
            items.push(value[index])
        }
        const next = offset + items.length < value.length ? offset + items.length : undefined
        return { saved, path, value: items, total: value.length, offset, ...(next !== undefined ? { next } : {}) }
    }
    if (typeof value === 'string') {
        const end = Math.min(value.length, offset + Math.min(limit ?? READ_BUDGET, READ_BUDGET))
        return { saved, path, value: value.slice(offset, end), total: value.length, offset, ...(end < value.length ? { next: end } : {}) }
    }
    if (sizeOf(value) <= READ_BUDGET) return { saved, path, value }
    return { saved, path, outline: outlineOf(value), note: 'Too big to read at once: read a key of it with a longer path.' }
}
