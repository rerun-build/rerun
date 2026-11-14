import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { cutOffWhenSettled } from './run-stream-merge.js'
import type { RunOutcome } from './loop.js'

function open(): { stream: ReadableStream<UIMessageChunk>; push: (chunk: UIMessageChunk) => void; close: () => void } {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>
    const stream = new ReadableStream<UIMessageChunk>({
        start(c) {
            controller = c
        },
    })
    return { stream, push: chunk => controller.enqueue(chunk), close: () => controller.close() }
}

async function drain(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
    const out: UIMessageChunk[] = []
    const reader = stream.getReader()
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        out.push(value)
    }
    return out
}

const settledWith = (outcome: RunOutcome): Promise<RunOutcome> => Promise.resolve(outcome)

describe('cutOffWhenSettled', () => {
    it('closes a stream whose source never ends once the run failed', async () => {
        const source = open()
        source.push({ type: 'text-start', id: '0' })

        const chunks = await drain(cutOffWhenSettled(source.stream, settledWith({ kind: 'error', error: 'the provider gave up' })))

        expect(chunks[0]).toEqual({ type: 'text-start', id: '0' })
        expect(chunks.at(-1)).toEqual({ type: 'error', errorText: 'the provider gave up' })
    }, 10_000)

    it('closes without an error chunk when the run was stopped', async () => {
        const source = open()

        const chunks = await drain(cutOffWhenSettled(source.stream, settledWith({ kind: 'cancelled' })))

        expect(chunks).toEqual([])
    }, 10_000)

    it('lets a finished run drain to its last chunk', async () => {
        const source = open()
        const chunks = drain(cutOffWhenSettled(source.stream, settledWith({ kind: 'done' })))

        await new Promise(r => setTimeout(r, 40))
        source.push({ type: 'text-delta', id: '0', delta: 'tail' })
        source.close()

        expect(await chunks).toEqual([{ type: 'text-delta', id: '0', delta: 'tail' }])
    }, 10_000)
})

describe('withQuickReplies', () => {
    const chunks: UIMessageChunk[] = [
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: 'Done.' },
        { type: 'text-end', id: '0' },
        { type: 'finish' } as UIMessageChunk,
    ]
    const fromChunks = (items: UIMessageChunk[]) =>
        new ReadableStream<UIMessageChunk>({
            start(controller) {
                for (const chunk of items) controller.enqueue(chunk)
                controller.close()
            },
        })

    it('hands the chat the replies as the call it draws the buttons from, right before the end', async () => {
        const { withQuickReplies } = await import('./run-stream-merge.js')
        const out = await drain(withQuickReplies(fromChunks(chunks), () => ({ toolCallId: 'q1', replies: ['Find 100 more'] })))
        expect(out.map(c => c.type)).toEqual(['text-start', 'text-delta', 'text-end', 'tool-input-available', 'finish'])
        expect(out[3]).toEqual({ type: 'tool-input-available', toolCallId: 'q1', toolName: 'suggest_replies', input: { replies: ['Find 100 more'] } })
    })

    it('adds nothing when the message closed without a block, or when the run offers no replies', async () => {
        const { withQuickReplies } = await import('./run-stream-merge.js')
        expect((await drain(withQuickReplies(fromChunks(chunks), () => undefined))).map(c => c.type)).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
        expect((await drain(withQuickReplies(fromChunks(chunks), undefined))).map(c => c.type)).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
    })
})
