import { generateText, type LanguageModel } from 'ai'
import { renderTextToImages } from 'pxpipe-proxy/transform'

const ID_COUNT = 20
const ID_LENGTH = 12
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const EXACT_READ_PROMPT = 'List every 12-character id on this page, one per line, nothing else.'

function seeded(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const FILLER = [
    'worker pool resized to 2 after backlog drained',
    'cache warm, 4182 entries kept, 311 evicted',
    'retry scheduled in 30s, attempt 2 of 5',
    'heartbeat ok, queue depth 0',
    'config reloaded from disk without changes',
]

export function makeIdSheet(seed: number): { ids: string[]; text: string } {
    const next = seeded(seed)
    const ids = new Set<string>()
    while (ids.size < ID_COUNT) {
        let id = ''
        for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[Math.floor(next() * ALPHABET.length)]
        ids.add(id)
    }
    const list = [...ids]
    const lines: string[] = []
    list.forEach((id, i) => {
        lines.push(`2026-11-13 10:${String(i).padStart(2, '0')}:00 INFO ${FILLER[Math.floor(next() * FILLER.length)]}`)
        lines.push(`2026-11-13 10:${String(i).padStart(2, '0')}:07 INFO job started id=${id} status=ok`)
    })
    return { ids: list, text: lines.join('\n') }
}

export async function renderSheet(text: string): Promise<Buffer> {
    const { pages } = await renderTextToImages(text)
    if (pages.length !== 1) throw new Error(`exact-read sheet rendered as ${pages.length} pages, expected 1`)
    return Buffer.from(pages[0]!.png)
}

export function scoreExactRead(ids: string[], answer: string): { score: number; misses: string[] } {
    const tokens = new Set(answer.match(/[A-Za-z0-9]+/g) ?? [])
    const misses = [...new Set(ids)].filter(id => !tokens.has(id))
    return { score: new Set(ids).size - misses.length, misses }
}

export type ExactReadTarget = { provider: string; model: string; languageModel: LanguageModel }

export async function runExactRead(target: ExactReadTarget, seed: number, abortSignal?: AbortSignal): Promise<{ provider: string; model: string; score: number; seed: number }> {
    const { ids, text } = makeIdSheet(seed)
    const png = await renderSheet(text)
    const { text: answer } = await generateText({
        model: target.languageModel,
        messages: [{ role: 'user', content: [{ type: 'image', image: png, mediaType: 'image/png' }, { type: 'text', text: EXACT_READ_PROMPT }] }],
        abortSignal,
    })
    return { provider: target.provider, model: target.model, score: scoreExactRead(ids, answer).score, seed }
}
