import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerRunStream, subscribeRunStream } from './run-streams.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function controlledSource() {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c
        },
    })
    return {
        stream,
        push: (text: string) => controller.enqueue(encoder.encode(text)),
        close: () => controller.close(),
        fail: (err: unknown) => controller.error(err),
    }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    let out = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) return out + decoder.decode()
        out += decoder.decode(value, { stream: true })
    }
}

const flush = () => new Promise(r => setTimeout(r, 0))

afterEach(() => {
    vi.useRealTimers()
})

describe('run stream hub', () => {
    it('closes live subscribers cleanly when the source errors', async () => {
        const source = controlledSource()
        registerRunStream('err-run', source.stream)
        const received = readAll(subscribeRunStream('err-run')!)

        source.push('before ')
        await flush()
        source.fail(new Error('provider died'))

        await expect(received).resolves.toBe('before ')
        await expect(readAll(subscribeRunStream('err-run')!)).resolves.toBe('before ')
    })

    it('replays everything and closes at once for a subscriber arriving after the end', async () => {
        const source = controlledSource()
        registerRunStream('done-run', source.stream)
        source.push('a')
        source.push('b')
        source.close()
        await flush()

        await expect(readAll(subscribeRunStream('done-run')!)).resolves.toBe('ab')
    })

    it('feeds every subscriber the same chunks', async () => {
        const source = controlledSource()
        registerRunStream('multi-run', source.stream)
        const first = readAll(subscribeRunStream('multi-run')!)
        source.push('x')
        await flush()
        const second = readAll(subscribeRunStream('multi-run')!)
        source.push('y')
        source.close()

        await expect(first).resolves.toBe('xy')
        await expect(second).resolves.toBe('xy')
    })

    it('keeps feeding the others when one subscriber cancels', async () => {
        const source = controlledSource()
        registerRunStream('cancel-run', source.stream)
        const leaving = subscribeRunStream('cancel-run')!
        const staying = readAll(subscribeRunStream('cancel-run')!)
        source.push('1')
        await flush()

        await leaving.cancel()
        source.push('2')
        source.close()

        await expect(staying).resolves.toBe('12')
    })

    it('starts over when a run id is registered again', async () => {
        const first = controlledSource()
        registerRunStream('again-run', first.stream)
        first.push('old')
        first.close()
        await flush()

        const second = controlledSource()
        registerRunStream('again-run', second.stream)
        second.push('new')
        second.close()
        await flush()

        await expect(readAll(subscribeRunStream('again-run')!)).resolves.toBe('new')
    })

    it('forgets a finished run three minutes after it ended', async () => {
        vi.useFakeTimers()
        const source = controlledSource()
        registerRunStream('evict-run', source.stream)
        source.close()
        await vi.advanceTimersByTimeAsync(0)

        await vi.advanceTimersByTimeAsync(3 * 60 * 1000 - 1)
        expect(subscribeRunStream('evict-run')).not.toBeNull()

        await vi.advanceTimersByTimeAsync(1)
        expect(subscribeRunStream('evict-run')).toBeNull()
    })

    it('does not let the eviction of a previous registration drop the new one', async () => {
        vi.useFakeTimers()
        const first = controlledSource()
        registerRunStream('reuse-run', first.stream)
        first.close()
        await vi.advanceTimersByTimeAsync(60 * 1000)

        const second = controlledSource()
        registerRunStream('reuse-run', second.stream)
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

        expect(subscribeRunStream('reuse-run')).not.toBeNull()
    })

    it('evicts the live re-registration when the replaced source ends later', async () => {
        vi.useFakeTimers()
        const first = controlledSource()
        registerRunStream('overlap-run', first.stream)
        const second = controlledSource()
        registerRunStream('overlap-run', second.stream)

        first.close()
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

        // Looks wrong: the eviction deletes by run id, not by buffer, so the still-running second stream is dropped.
        expect(subscribeRunStream('overlap-run')).toBeNull()
    })
})

const sse = (chunk: UIMessageChunk | string) => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`

function eventsOf(text: string): string[] {
    return text.split('\n\n').filter(Boolean)
}

async function messageOf(text: string): Promise<UIMessage | undefined> {
    const chunks = eventsOf(text)
        .map(event => event.replace(/^data: /, ''))
        .filter(data => data !== '[DONE]')
        .map(data => JSON.parse(data) as UIMessageChunk)
    const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk)
            controller.close()
        },
    })
    let last: UIMessage | undefined
    for await (const message of readUIMessageStream({ stream })) last = message
    return last
}

const pieces = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, k) => text.slice(k * size, (k + 1) * size))

// A turn the way a model streams it: a delta every few characters of its reasoning, its text and each
// tool's input, every output whole.
function streamedTurn(): string[] {
    const answer = 'The agencies answered: nine want a demo this week, three never opened the mail. '.repeat(300)
    const thought = 'Checking which agencies replied before drafting the recap. '.repeat(60)
    const command = JSON.stringify({ command: `cat <<'EOF' > recap.md\n${'line of the recap\n'.repeat(120)}EOF` })
    const events: UIMessageChunk[] = [{ type: 'start', messageId: 'turn-1' }, { type: 'start-step' }, { type: 'reasoning-start', id: 'r1' }]
    for (const delta of pieces(thought, 12)) events.push({ type: 'reasoning-delta', id: 'r1', delta })
    events.push({ type: 'reasoning-end', id: 'r1' })
    for (const toolCallId of ['call-1', 'call-2']) {
        events.push({ type: 'tool-input-start', toolCallId, toolName: 'shell_exec' })
        for (const inputTextDelta of pieces(command, 12)) events.push({ type: 'tool-input-delta', toolCallId, inputTextDelta })
        events.push({ type: 'tool-input-available', toolCallId, toolName: 'shell_exec', input: JSON.parse(command) })
        events.push({ type: 'tool-output-available', toolCallId, output: { stdout: 'written', exitCode: 0 } })
    }
    events.push({ type: 'text-start', id: 't1' })
    for (const delta of pieces(answer, 12)) events.push({ type: 'text-delta', id: 't1', delta })
    events.push({ type: 'text-end', id: 't1' }, { type: 'finish-step' }, { type: 'finish' })
    return [...events.map(sse), sse('[DONE]')]
}

describe('a run picked up again', () => {
    it('replays what was already streamed in a few chunks, not one per delta', async () => {
        const turn = streamedTurn()
        const source = controlledSource()
        registerRunStream('long-run', source.stream)
        const live = readAll(subscribeRunStream('long-run')!)
        for (const event of turn) source.push(event)
        source.close()
        await flush()

        const replayed = await readAll(subscribeRunStream('long-run')!)

        expect(turn.length).toBeGreaterThan(2_500)
        expect(eventsOf(replayed).length).toBeLessThan(40)
        expect(await messageOf(replayed)).toEqual(await messageOf(await live))
    })

    it('hands every chunk after the replay over as it comes', async () => {
        const source = controlledSource()
        registerRunStream('joined-run', source.stream)
        source.push(sse({ type: 'start', messageId: 'turn-2' }) + sse({ type: 'text-start', id: 't1' }))
        for (const delta of ['Nine ', 'agencies ', 'answered']) source.push(sse({ type: 'text-delta', id: 't1', delta }))
        await flush()

        const joined = readAll(subscribeRunStream('joined-run')!)
        for (const delta of [', three ', 'did not.']) source.push(sse({ type: 'text-delta', id: 't1', delta }))
        source.push(sse({ type: 'text-end', id: 't1' }) + sse({ type: 'finish' }))
        source.close()

        const events = eventsOf(await joined)
        expect(events).toEqual([`data: ${JSON.stringify({ type: 'start', messageId: 'turn-2' })}`, `data: ${JSON.stringify({ type: 'text-start', id: 't1' })}`, `data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'Nine agencies answered' })}`, `data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: ', three ' })}`, `data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'did not.' })}`, `data: ${JSON.stringify({ type: 'text-end', id: 't1' })}`, `data: ${JSON.stringify({ type: 'finish' })}`])
    })

    it('keeps the deltas of a tool input still being written, merged', async () => {
        const source = controlledSource()
        registerRunStream('typing-run', source.stream)
        source.push(sse({ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'fs_write' }))
        for (const inputTextDelta of ['{"path":', '"recap', '.md"']) source.push(sse({ type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta }))
        await flush()

        const replayed = subscribeRunStream('typing-run')!
        source.close()

        expect(eventsOf(await readAll(replayed))).toEqual([`data: ${JSON.stringify({ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'fs_write' })}`, `data: ${JSON.stringify({ type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: '{"path":"recap.md"' })}`])
    })

    it('keeps the deltas of a tool call id used again in a later step', async () => {
        const firstCall = [sse({ type: 'start' }), sse({ type: 'start-step' }), sse({ type: 'tool-input-start', toolCallId: 'call_0', toolName: 'shell_exec' }), sse({ type: 'tool-input-delta', toolCallId: 'call_0', inputTextDelta: '{"command":"ls"}' }), sse({ type: 'tool-input-available', toolCallId: 'call_0', toolName: 'shell_exec', input: { command: 'ls' } }), sse({ type: 'tool-output-available', toolCallId: 'call_0', output: 'recap.md' }), sse({ type: 'finish-step' })]
        const secondCall = [sse({ type: 'start-step' }), sse({ type: 'tool-input-start', toolCallId: 'call_0', toolName: 'fs_write' }), ...['{"path":', '"recap.md"'].map(inputTextDelta => sse({ type: 'tool-input-delta', toolCallId: 'call_0', inputTextDelta }))]
        const source = controlledSource()
        registerRunStream('reused-id-run', source.stream)
        source.push([...firstCall, ...secondCall].join(''))
        await flush()

        const replayed = subscribeRunStream('reused-id-run')!
        source.close()

        const events = eventsOf(await readAll(replayed))
        expect(events.at(-1)).toBe(`data: ${JSON.stringify({ type: 'tool-input-delta', toolCallId: 'call_0', inputTextDelta: '{"path":"recap.md"' })}`)
        expect(events.join('\n\n')).not.toContain('{\\"command\\":\\"ls\\"}"')
    })

    it('passes an event cut in the middle of a character on as it came', async () => {
        const whole = encoder.encode(sse({ type: 'text-start', id: 't1' }) + sse({ type: 'text-delta', id: 't1', delta: 'Déjà ' }) + sse({ type: 'text-delta', id: 't1', delta: 'vu 🎉' }))
        const cut = whole.length - 6
        let controller!: ReadableStreamDefaultController<Uint8Array>
        registerRunStream('cut-run', new ReadableStream<Uint8Array>({ start: c => void (controller = c) }))
        controller.enqueue(whole.slice(0, cut))
        await flush()

        const replayed = subscribeRunStream('cut-run')!
        controller.enqueue(whole.slice(cut))
        controller.close()

        const text = await readAll(replayed)
        expect(text).toContain('🎉')
        expect(text).not.toContain('�')
        expect(eventsOf(text)).toEqual([`data: ${JSON.stringify({ type: 'text-start', id: 't1' })}`, `data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'Déjà ' })}`, `data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'vu 🎉' })}`])
    })

    it('passes what is not a chunk on untouched', async () => {
        const source = controlledSource()
        registerRunStream('odd-run', source.stream)
        const typeNotFirst = 'data: {"id":"t1","type":"text-delta","delta":"c"}'
        const spaced = 'data: {"type":"tool-output-available", "toolCallId":"call-1","output":{"stdout":"é"}}'
        source.push(sse({ type: 'text-delta', id: 't1', delta: 'a' }) + ': keepalive\n\n' + sse({ type: 'text-delta', id: 't1', delta: 'b' }) + `${typeNotFirst}\n\n${spaced}\n\n` + 'data: {not json\n\n' + sse('[DONE]'))
        source.close()
        await flush()

        expect(eventsOf(await readAll(subscribeRunStream('odd-run')!))).toEqual([`data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'a' })}`, ': keepalive', `data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'b' })}`, typeNotFirst, spaced, 'data: {not json', 'data: [DONE]'])
    })
})
