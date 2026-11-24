import { describe, expect, it } from 'vitest'
import { deadlineSignal, raceAbort, settledWithin } from './abort.js'

describe('raceAbort', () => {
    it('resolves with the work when it settles first', async () => {
        await expect(raceAbort(Promise.resolve('done'), new AbortController().signal)).resolves.toBe('done')
    })

    it('stops waiting on work that never settles once the signal fires', async () => {
        await expect(raceAbort(new Promise(() => {}), deadlineSignal(20))).rejects.toMatchObject({ name: 'TimeoutError' })
    })

    it('rejects at once on a signal already aborted', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(raceAbort(new Promise(() => {}), controller.signal)).rejects.toBeDefined()
    })

    it('leaves no orphan rejection behind when the signal was already aborted', async () => {
        const orphans: unknown[] = []
        const onOrphan = (reason: unknown) => orphans.push(reason)
        process.on('unhandledRejection', onOrphan)
        const controller = new AbortController()
        controller.abort()
        try {
            await expect(raceAbort(Promise.reject(new Error('late')), controller.signal)).rejects.toBeDefined()
            await new Promise(resolve => setTimeout(resolve, 0))
        } finally {
            process.off('unhandledRejection', onOrphan)
        }
        expect(orphans).toEqual([])
    })
})

describe('deadlineSignal', () => {
    it('follows the parent signal before the deadline', () => {
        const parent = new AbortController()
        const signal = deadlineSignal(60_000, parent.signal)
        parent.abort()
        expect(signal.aborted).toBe(true)
    })
})

describe('settledWithin', () => {
    it.each([
        ['ended', () => Promise.resolve(), true],
        ['failed', () => Promise.reject(new Error('refused')), true],
        ['hangs', () => new Promise(() => {}), false],
    ])('tells of work that %s', async (_name, work, expected) => {
        expect(await settledWithin(work(), 20)).toBe(expected)
    })
})
