import { describe, expect, it, vi } from 'vitest'
import { abortRun, activeRunCount, agentHasLiveRun, claimSession, registerRunAbort, releaseSession, sessionClaim, sessionClaimCount, setRunCancel, unregisterRunAbort } from './run-control.js'

describe('abortRun', () => {
    it('returns null for a run it never registered', () => {
        expect(abortRun('ghost')).toBeNull()
    })

    it('aborts the signal, runs the cancel hook, frees the claim and forgets the run', async () => {
        const before = activeRunCount()
        const controller = registerRunAbort('run-a', 'agent-1')
        const cancel = vi.fn(async () => {})
        setRunCancel('run-a', cancel)
        expect(claimSession('sess-a', 'run-a')).toBeNull()
        expect(activeRunCount()).toBe(before + 1)

        await abortRun('run-a')

        expect(controller.signal.aborted).toBe(true)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(sessionClaim('sess-a')).toBeNull()
        expect(activeRunCount()).toBe(before)
    })

    it('returns null on a second abort and does not cancel twice', () => {
        registerRunAbort('run-b', 'agent-1')
        const cancel = vi.fn(async () => {})
        setRunCancel('run-b', cancel)

        expect(abortRun('run-b')).not.toBeNull()
        expect(abortRun('run-b')).toBeNull()
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('aborts a run that never set a cancel hook', () => {
        const controller = registerRunAbort('run-c', 'agent-1')
        expect(abortRun('run-c')).not.toBeNull()
        expect(controller.signal.aborted).toBe(true)
    })

    it('holds the conversation until the cancel hook has stored the turn', async () => {
        registerRunAbort('run-d', 'agent-1')
        claimSession('sess-d', 'run-d')
        let stored!: () => void
        setRunCancel('run-d', () => new Promise(resolve => (stored = resolve)))

        const stopping = abortRun('run-d')
        expect(sessionClaim('sess-d')?.runId).toBe('run-d')
        expect(claimSession('sess-d', 'next')).toBe('run-d')

        stored()
        await stopping
        expect(sessionClaim('sess-d')).toBeNull()
    })

    it('frees the conversation when the cancel hook fails', async () => {
        registerRunAbort('run-e', 'agent-1')
        claimSession('sess-e', 'run-e')
        setRunCancel('run-e', async () => {
            throw new Error('disk full')
        })

        await abortRun('run-e')

        expect(sessionClaim('sess-e')).toBeNull()
    })
})

describe('setRunCancel', () => {
    it('ignores a run that is not registered', () => {
        const cancel = vi.fn(async () => {})
        setRunCancel('not-registered', cancel)
        registerRunAbort('not-registered', 'agent-1')
        abortRun('not-registered')
        expect(cancel).not.toHaveBeenCalled()
    })
})

describe('session claims', () => {
    it('does nothing when releasing a run that holds no claim', () => {
        claimSession('sess-held', 'holder')
        const count = sessionClaimCount()

        releaseSession('no-claim')

        expect(sessionClaimCount()).toBe(count)
        expect(sessionClaim('sess-held')?.runId).toBe('holder')
        releaseSession('holder')
    })

    it('records who holds a session and since when', () => {
        const before = Date.now()
        claimSession('sess-time', 'run-t')

        const claim = sessionClaim('sess-time')

        expect(claim?.runId).toBe('run-t')
        expect(claim?.claimedAt).toBeGreaterThanOrEqual(before)
        expect(claim?.claimedAt).toBeLessThanOrEqual(Date.now())
        releaseSession('run-t')
        expect(sessionClaim('sess-time')).toBeNull()
    })

    it('counts claimed sessions', () => {
        const before = sessionClaimCount()
        claimSession('sess-1', 'r1')
        claimSession('sess-2', 'r2')
        claimSession('sess-2', 'r3')

        expect(sessionClaimCount()).toBe(before + 2)

        releaseSession('r1')
        releaseSession('r2')
        expect(sessionClaimCount()).toBe(before)
    })

    it('keeps the holder claim when a refused run releases', () => {
        claimSession('sess-x', 'holder-x')
        expect(claimSession('sess-x', 'refused')).toBe('holder-x')

        releaseSession('refused')

        expect(sessionClaim('sess-x')?.runId).toBe('holder-x')
        releaseSession('holder-x')
    })

    it('unregistering a run frees its claim and drops it from the active count', () => {
        const before = activeRunCount()
        registerRunAbort('run-u', 'agent-1')
        claimSession('sess-u', 'run-u')

        unregisterRunAbort('run-u')

        expect(activeRunCount()).toBe(before)
        expect(sessionClaim('sess-u')).toBeNull()
        expect(abortRun('run-u')).toBeNull()
    })

    it('knows which coworkers have a run live, until it ends or is aborted', () => {
        registerRunAbort('live-1', 'coworker')
        registerRunAbort('live-2', 'coworker')
        expect(agentHasLiveRun('coworker')).toBe(true)
        expect(agentHasLiveRun('someone-else')).toBe(false)

        unregisterRunAbort('live-1')
        expect(agentHasLiveRun('coworker')).toBe(true)
        abortRun('live-2')
        expect(agentHasLiveRun('coworker')).toBe(false)
    })

    it('remembers who started the run holding a conversation', () => {
        claimSession('sess-author', 'run-author', 'u1')
        expect(sessionClaim('sess-author')?.authorId).toBe('u1')
        releaseSession('run-author')
        claimSession('sess-author', 'run-unsigned')
        expect(sessionClaim('sess-author')?.authorId).toBeUndefined()
        releaseSession('run-unsigned')
    })
})

describe('the run of a script routine', () => {
    it('counts as a live run and can be aborted, but leaves its coworker free for a run of its own', () => {
        const before = activeRunCount()
        const controller = registerRunAbort('script-run', 'agent-script', { script: true })
        expect(activeRunCount()).toBe(before + 1)
        expect(agentHasLiveRun('agent-script')).toBe(false)

        registerRunAbort('model-run', 'agent-script')
        expect(agentHasLiveRun('agent-script')).toBe(true)
        unregisterRunAbort('model-run')

        expect(abortRun('script-run')).not.toBeNull()
        expect(controller.signal.aborted).toBe(true)
        expect(activeRunCount()).toBe(before)
    })
})
