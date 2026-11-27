// @vitest-environment happy-dom
import type { RemoteJob } from '@rerun/contracts'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const attention = vi.hoisted(() => ({ value: 'focused' as 'focused' | 'visible' | 'hidden', listeners: new Set<() => void>() }))
vi.mock('@/lib/desktop-shell/attention', () => ({
    pageAttention: () => attention.value,
    subscribePageAttention: (listener: () => void) => {
        attention.listeners.add(listener)
        return () => attention.listeners.delete(listener)
    },
}))

type JobAnswer = Awaited<ReturnType<typeof import('@/app/api/_actions/remote-computers.actions').computerJobAction>>
const actions = vi.hoisted(() => ({ computerJobAction: vi.fn<() => Promise<unknown>>(), stopComputerJobAction: vi.fn() }))
vi.mock('@/app/api/_actions/remote-computers.actions', () => actions)
vi.mock('@rerun/ui', () => ({ BorderBeam: () => null }))

const { ComputerJobCard } = await import('./ComputerJobCard')

const SECOND = 1000

function job(state: RemoteJob['state']): RemoteJob {
    return { id: 'job-1', command: 'render.sh', state, startedAt: new Date().toISOString(), endedAt: state === 'running' ? null : new Date().toISOString() } as RemoteJob
}

const running: JobAnswer = { ok: true, logs: { job: job('running'), output: 'frame 12' } as never }
const offline: JobAnswer = { ok: true, logs: null }
const failed: JobAnswer = { ok: false, code: 'unknown' } as never

describe('ComputerJobCard', () => {
    let root: Root
    let answer: JobAnswer

    const reads = () => actions.computerJobAction.mock.calls.length
    const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

    beforeEach(async () => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        vi.useFakeTimers()
        attention.value = 'focused'
        answer = running
        actions.computerJobAction.mockReset().mockImplementation(async () => answer)
        root = createRoot(document.createElement('div'))
        await act(async () => root.render(createElement(ComputerJobCard, { computer: 'studio', jobId: 'job-1', command: 'render.sh' })))
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        vi.useRealTimers()
    })

    it('reads a running job every five seconds', async () => {
        expect(reads()).toBe(1)
        await wait(30 * SECOND)
        expect(reads()).toBe(7)
    })

    it('reads once a minute while the computer is offline, and every five seconds once it is back', async () => {
        answer = offline
        await wait(5 * SECOND)
        const wentOffline = reads()
        await wait(5 * 60 * SECOND)
        expect(reads() - wentOffline).toBeLessThanOrEqual(6)

        answer = running
        await wait(60 * SECOND)
        const back = reads()
        await wait(30 * SECOND)
        expect(reads() - back).toBeGreaterThanOrEqual(6)
    })

    it('slows down the same way when the read fails', async () => {
        answer = failed
        await wait(5 * SECOND)
        const firstFailure = reads()
        await wait(5 * 60 * SECOND)
        expect(reads() - firstFailure).toBeLessThanOrEqual(6)
    })

    it('stops reading once the job has ended', async () => {
        answer = { ok: true, logs: { job: job('succeeded'), output: 'done' } as never }
        await wait(5 * SECOND)
        const ended = reads()
        await wait(5 * 60 * SECOND)
        expect(reads()).toBe(ended)
    })

    it('reads nothing while the page is hidden', async () => {
        await act(async () => {
            attention.value = 'hidden'
            for (const listener of attention.listeners) listener()
        })
        const hidden = reads()
        await wait(5 * 60 * SECOND)
        expect(reads()).toBe(hidden)
    })
})
