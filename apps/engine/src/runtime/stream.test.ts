import { describe, expect, it } from 'vitest'
import { registerRun } from './stream.js'
import { subscribeRunStream } from './run-streams.js'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        out += decoder.decode(value, { stream: true })
    }
    return out
}

const settle = () => new Promise(r => setTimeout(r, 20))

describe('registerRun', () => {
    it('runs to completion with nobody attached, then replays in full', async () => {
        registerRun('headless-1', async writer => {
            writer.write({ type: 'data-step', id: '1', data: { n: 1 } })
            writer.write({ type: 'data-step', id: '2', data: { n: 2 } })
        })

        await settle()

        const replay = await readAll(subscribeRunStream('headless-1')!)
        expect(replay).toContain('"n":1')
        expect(replay).toContain('"n":2')
    })

    it('gives a subscriber attaching mid-run the earlier chunks and the live remainder', async () => {
        let release: () => void
        const gate = new Promise<void>(r => (release = r))

        registerRun('headless-2', async writer => {
            writer.write({ type: 'data-step', id: '1', data: { n: 1 } })
            await gate
            writer.write({ type: 'data-step', id: '2', data: { n: 2 } })
        })

        await settle()

        const tail = readAll(subscribeRunStream('headless-2')!)
        release!()

        const received = await tail
        expect(received).toContain('"n":1')
        expect(received).toContain('"n":2')
    })

    it('returns null for a run the hub never saw', () => {
        expect(subscribeRunStream('never-registered')).toBeNull()
    })
})
