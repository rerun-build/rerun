import { isRecord } from '@rerun/contracts'

type Subscriber = (chunk: Uint8Array | null) => void

type RunBuffer = {
    chunks: Uint8Array[]
    done: boolean
    subscribers: Set<Subscriber>
    evict?: ReturnType<typeof setTimeout>
}

const EVICT_AFTER_MS = 3 * 60 * 1000

const hub = new Map<string, RunBuffer>()

export function registerRunStream(runId: string, source: ReadableStream<Uint8Array>): void {
    const existing = hub.get(runId)
    if (existing?.evict) clearTimeout(existing.evict)
    const buf: RunBuffer = { chunks: [], done: false, subscribers: new Set() }
    hub.set(runId, buf)
    void (async () => {
        const reader = source.getReader()
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf.chunks.push(value)
                for (const sub of buf.subscribers) sub(value)
            }
        } catch {
        } finally {
            buf.done = true
            for (const sub of buf.subscribers) sub(null)
            buf.subscribers.clear()
            buf.evict = setTimeout(() => hub.delete(runId), EVICT_AFTER_MS)
        }
    })()
}

type Chunk = Record<string, unknown> & { type?: unknown }

const DELTA_TEXT: Record<string, string> = { 'text-delta': 'delta', 'reasoning-delta': 'delta', 'tool-input-delta': 'inputTextDelta' }
const INPUT_WHOLE = new Set(['tool-input-available', 'tool-input-error'])
// The AI SDK writes `type` first, so the prefix spares parsing every tool output: an event written
// otherwise is only passed on unmerged, which leaves the message the same.
const MERGED_PREFIXES = [...Object.keys(DELTA_TEXT), ...INPUT_WHOLE].map(type => `data: {"type":"${type}"`)
const keyOf = (chunk: Chunk) => (chunk.type === 'tool-input-delta' ? chunk.toolCallId : chunk.id)

// What a run already streamed, for a client that picks it up again (a phone back from the background):
// one event per delta made a long run thousands of events, read in one go without ever drawing a frame
// (RER-350). Consecutive deltas of one part travel as one, and the deltas of a tool input whose whole
// input is already there are left out: the message they assemble is the same.
function mergedHistory(chunks: Uint8Array[]): Uint8Array[] {
    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
    }
    let end = bytes.length - 1
    while (end > 0 && !(bytes[end] === 0x0a && bytes[end - 1] === 0x0a)) end -= 1
    if (end <= 0) return chunks
    // After the last blank line: an event still on its way, maybe cut inside a character.
    const tail = bytes.subarray(end + 1)

    const events = new TextDecoder().decode(bytes.subarray(0, end - 1)).split('\n\n')
    const parsed = events.map((event): Chunk | null => {
        if (!MERGED_PREFIXES.some(prefix => event.startsWith(prefix))) return null
        try {
            const chunk: unknown = JSON.parse(event.slice('data: '.length))
            return isRecord(chunk) ? chunk : null
        } catch {
            return null
        }
    })
    const wholeAt = new Map(parsed.flatMap((chunk, index) => (typeof chunk?.type === 'string' && INPUT_WHOLE.has(chunk.type) ? [[chunk.toolCallId, index] as const] : [])))

    const out: (Chunk | string)[] = []
    for (const [index, chunk] of parsed.entries()) {
        const field = chunk && typeof chunk.type === 'string' ? DELTA_TEXT[chunk.type] : undefined
        if (!chunk || !field) {
            out.push(events[index])
            continue
        }
        if (chunk.type === 'tool-input-delta' && (wholeAt.get(chunk.toolCallId) ?? -1) > index) continue
        const previous = out.at(-1)
        if (typeof previous === 'object' && previous.type === chunk.type && keyOf(previous) === keyOf(chunk)) {
            out[out.length - 1] = { ...previous, ...chunk, [field]: `${previous[field] ?? ''}${chunk[field] ?? ''}`, providerMetadata: chunk.providerMetadata ?? previous.providerMetadata }
            continue
        }
        out.push(chunk)
    }

    const history = new TextEncoder().encode(out.map(event => `${typeof event === 'string' ? event : `data: ${JSON.stringify(event)}`}\n\n`).join(''))
    return tail.length > 0 ? [history, tail.slice()] : [history]
}

export function subscribeRunStream(runId: string): ReadableStream<Uint8Array> | null {
    const buf = hub.get(runId)
    if (!buf) return null
    let sub: Subscriber | undefined
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of mergedHistory(buf.chunks)) controller.enqueue(chunk)
            if (buf.done) {
                controller.close()
                return
            }
            sub = chunk => {
                if (chunk === null) controller.close()
                else controller.enqueue(chunk)
            }
            buf.subscribers.add(sub)
        },
        cancel() {
            if (sub) buf.subscribers.delete(sub)
        },
    })
}
