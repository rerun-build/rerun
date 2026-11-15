import { describe, expect, it, vi } from 'vitest'
import type { UIMessageStreamWriter } from 'ai'
import { announceToAgentRuns, registerRunAbort, unregisterRunAbort } from './run-control.js'

vi.mock('../db/repos/agents.js', () => ({ setAgentStatus: vi.fn(async () => {}) }))

const part = { type: 'data-note', data: { text: 'hi' } } as Parameters<UIMessageStreamWriter['write']>[0]

function fakeWriter(write: () => void = () => {}): UIMessageStreamWriter {
    return { write: vi.fn(write) } as unknown as UIMessageStreamWriter
}

describe('announceToAgentRuns', () => {
    it('writes the part to every live run of the agent and returns how many', () => {
        const w1 = fakeWriter()
        const w2 = fakeWriter()
        const other = fakeWriter()
        registerRunAbort('w-r1', 'w-a1', w1)
        registerRunAbort('w-r2', 'w-a1', w2)
        registerRunAbort('w-r3', 'w-a2', other)

        expect(announceToAgentRuns('w-a1', part)).toBe(2)

        expect(w1.write).toHaveBeenCalledWith(part)
        expect(w2.write).toHaveBeenCalledWith(part)
        expect(other.write).not.toHaveBeenCalled()
        for (const id of ['w-r1', 'w-r2', 'w-r3']) unregisterRunAbort(id)
    })

    it('stops writing to a run once it is unregistered', () => {
        const w1 = fakeWriter()
        const w2 = fakeWriter()
        registerRunAbort('u-r1', 'u-a1', w1)
        registerRunAbort('u-r2', 'u-a1', w2)
        unregisterRunAbort('u-r1')

        expect(announceToAgentRuns('u-a1', part)).toBe(1)

        expect(w1.write).not.toHaveBeenCalled()
        expect(w2.write).toHaveBeenCalledTimes(1)
        unregisterRunAbort('u-r2')
    })

    it('skips a writer that throws and still reaches the others', () => {
        const bad = fakeWriter(() => {
            throw new Error('closed')
        })
        const good = fakeWriter()
        registerRunAbort('t-r1', 't-a1', bad)
        registerRunAbort('t-r2', 't-a1', good)

        expect(announceToAgentRuns('t-a1', part)).toBe(1)

        expect(good.write).toHaveBeenCalledWith(part)
        unregisterRunAbort('t-r1')
        unregisterRunAbort('t-r2')
    })

    it('answers 0 for an agent without a live run or a run registered without a writer', () => {
        registerRunAbort('n-r1', 'n-a1')

        expect(announceToAgentRuns('n-a1', part)).toBe(0)
        expect(announceToAgentRuns('n-ghost', part)).toBe(0)
        unregisterRunAbort('n-r1')
    })
})
