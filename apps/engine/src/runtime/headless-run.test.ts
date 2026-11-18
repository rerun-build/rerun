import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-headless-'))
process.env.RERUN_API_KEY = ''

const state = vi.hoisted(() => ({
    started: 0,
    prepError: null as Error | null,
    calls: [] as unknown[][],
    merges: [] as Array<{ agentRun: unknown }>,
}))

vi.mock('../db/repos/runs.js', () => ({
    startRun: async () => ({ id: `headless-run-${++state.started}` }),
}))
vi.mock('./loop.js', () => ({
    runAgent: async (...args: unknown[]) => {
        state.calls.push(args)
        if (state.prepError) throw state.prepError
        return { runId: args[5], settled: Promise.resolve({ kind: 'done' }) }
    },
}))
vi.mock('./run-stream-merge.js', () => ({
    mergeRunStream: (writer: { write: (chunk: unknown) => void }, agentRun: unknown) => {
        state.merges.push({ agentRun })
        writer.write({ type: 'data-marker', data: { merged: true } })
    },
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { startHeadlessRun } = await import('./headless-run.js')
const { subscribeRunStream } = await import('./run-streams.js')

const agent = { id: 'headless-agent', resolved: { provider: 'openai', model: 'gpt-default' } } as never
const trigger = { source: 'schedule', slug: 'daily', name: 'Daily' } as const

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) return out
        out += decoder.decode(value)
    }
}

afterEach(() => {
    state.prepError = null
    state.calls = []
    state.merges = []
})

describe('startHeadlessRun', () => {
    it('resolves with the run once it has started and hands the run loop its row id', async () => {
        const run = await startHeadlessRun(agent, 'sess-1', 'do it', undefined, trigger)

        expect(run.runId).toBe(`headless-run-${state.started}`)
        expect(state.calls[0]).toEqual([agent, 'sess-1', 'do it', undefined, expect.anything(), run.runId, trigger])
    })

    it('publishes the run stream so the dashboard can attach to it later', async () => {
        const run = await startHeadlessRun(agent, 'sess-2', 'do it', undefined, trigger)

        const replay = await readAll(subscribeRunStream(run.runId)!)
        expect(replay).toContain('"merged":true')
    })

    // The run names the pair it is served on, a backup included, so the stream takes it from there.
    it('merges the run the loop handed back', async () => {
        const run = await startHeadlessRun(agent, 'sess-3', 'do it', undefined, trigger)

        expect(state.merges[0].agentRun).toMatchObject({ runId: run.runId })
    })

    it('rejects with the preparation error instead of losing it in the stream', async () => {
        state.prepError = new Error('no connection for provider')

        await expect(startHeadlessRun(agent, 'sess-6', 'do it', undefined, trigger)).rejects.toThrow('no connection for provider')
        expect(state.merges).toHaveLength(0)

        const replay = await readAll(subscribeRunStream(`headless-run-${state.started}`)!)
        expect(replay).toContain('no connection for provider')
    })
})
