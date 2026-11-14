import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ subscription: null as ReadableStream<Uint8Array> | null }))

vi.mock('./run-streams.js', async importOriginal => {
    const original = await importOriginal<typeof import('./run-streams.js')>()
    return { ...original, subscribeRunStream: (runId: string) => state.subscription ?? original.subscribeRunStream(runId) }
})

const { registerRun, resumeStreamResponse, toResumableStreamResponse } = await import('./stream.js')

const decoder = new TextDecoder()

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    let out = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        out += decoder.decode(value, { stream: true })
    }
    return out
}

function gate() {
    let release!: () => void
    const promise = new Promise<void>(r => (release = r))
    return { promise, release }
}

afterEach(() => {
    state.subscription = null
    vi.useRealTimers()
})

describe('registerRun', () => {
    it('turns a thrown execute into an error part carrying its message', async () => {
        registerRun('throws-1', async () => {
            throw new Error('provider refused the key')
        })

        const body = await readAll(resumeStreamResponse('throws-1').body!)

        expect(body).toContain('"type":"error"')
        expect(body).toContain('provider refused the key')
    })

    it('stringifies a thrown value that is not an Error', async () => {
        registerRun('throws-2', async () => {
            throw 'plain string failure'
        })

        expect(await readAll(resumeStreamResponse('throws-2').body!)).toContain('plain string failure')
    })
})

describe('toResumableStreamResponse', () => {
    it('streams the run as a UI message stream response', async () => {
        const res = toResumableStreamResponse('resumable-1', async writer => {
            writer.write({ type: 'data-step', id: '1', data: { n: 1 } })
        })

        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/event-stream')
        expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
        expect(await readAll(res.body!)).toContain('"n":1')
    })

    it('keeps a silent run alive with SSE comments until it speaks', async () => {
        vi.useFakeTimers()
        const hold = gate()
        const res = toResumableStreamResponse('resumable-2', async writer => {
            await hold.promise
            writer.write({ type: 'data-step', id: '1', data: { n: 2 } })
        })
        const reader = res.body!.getReader()

        await vi.advanceTimersByTimeAsync(15_000)
        const first = await reader.read()
        expect(decoder.decode(first.value)).toBe(': keepalive\n\n')

        hold.release()
        let rest = ''
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            rest += decoder.decode(value, { stream: true })
        }
        expect(rest).toContain('"n":2')
    })

    it('stops pinging once the client goes away, without stopping the run', async () => {
        vi.useFakeTimers()
        const hold = gate()
        const res = toResumableStreamResponse('resumable-3', async writer => {
            await hold.promise
            writer.write({ type: 'data-step', id: '1', data: { n: 3 } })
        })
        await vi.advanceTimersByTimeAsync(0)
        const timersWhileAttached = vi.getTimerCount()

        await res.body!.cancel('tab closed')

        expect(vi.getTimerCount()).toBe(timersWhileAttached - 1)
        hold.release()
        vi.useRealTimers()
        await new Promise(r => setTimeout(r, 20))
        expect(await readAll(resumeStreamResponse('resumable-3').body!)).toContain('"n":3')
    })

    it('surfaces a broken buffer as a stream error rather than a clean end', async () => {
        state.subscription = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new Error('buffer lost'))
            },
        })

        const res = toResumableStreamResponse('resumable-4', async () => {})

        await expect(readAll(res.body!)).rejects.toThrow('buffer lost')
    })
})

describe('resumeStreamResponse', () => {
    it('answers 204 for a run this engine has no buffer for', () => {
        const res = resumeStreamResponse('unknown-run')
        expect(res.status).toBe(204)
        expect(res.body).toBeNull()
    })

    it('replays a finished run with the UI message stream headers', async () => {
        registerRun('resume-1', async writer => {
            writer.write({ type: 'data-step', id: '1', data: { n: 4 } })
        })
        await new Promise(r => setTimeout(r, 20))

        const res = resumeStreamResponse('resume-1')

        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('text/event-stream')
        expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
        expect(await readAll(res.body!)).toContain('"n":4')
    })
})
