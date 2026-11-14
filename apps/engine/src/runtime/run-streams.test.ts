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
        if (done) return out
        out += decoder.decode(value)
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

        expect(subscribeRunStream('overlap-run')).toBeNull()
    })
})
