import { ApiError } from '@/api/client'

import { setUpWorkspace, type SetupSteps } from './workspace-setup'

const steps = (overrides: Partial<SetupSteps> = {}): jest.Mocked<SetupSteps> => ({
    startWorkspace: jest.fn().mockResolvedValue(true),
    claimEngine: jest.fn().mockResolvedValue(undefined),
    engineAnswers: jest.fn().mockResolvedValue(true),
    finish: jest.fn().mockResolvedValue(undefined),
    ...overrides,
} as jest.Mocked<SetupSteps>)

const FAST = { patienceMs: 50, pollMs: 1 }
const live = () => true

describe('setUpWorkspace', () => {
    it('starts the workspace, claims its machine, waits for it, then closes the onboarding', async () => {
        const run = steps({ engineAnswers: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true) })
        expect(await setUpWorkspace(run, live, FAST)).toBe('ready')
        expect(run.engineAnswers).toHaveBeenCalledTimes(3)
        expect(run.finish).toHaveBeenCalledTimes(1)
    })

    it('stops at a workspace the app cannot start, and claims nothing', async () => {
        const run = steps({ startWorkspace: jest.fn().mockResolvedValue(false) })
        expect(await setUpWorkspace(run, live, FAST)).toBe('blocked')
        expect(run.claimEngine).not.toHaveBeenCalled()
    })

    it('reads a start the hub turned away as refused: no machine is left', async () => {
        const run = steps({ startWorkspace: jest.fn().mockRejectedValue(new ApiError(409, 'Every machine is taken right now.')) })
        expect(await setUpWorkspace(run, live, FAST)).toBe('refused')
    })

    it('fails without closing the onboarding when the machine never answers', async () => {
        const run = steps({ engineAnswers: jest.fn().mockResolvedValue(false) })
        expect(await setUpWorkspace(run, live, FAST)).toBe('failed')
        expect(run.finish).not.toHaveBeenCalled()
    })

    it('keeps waiting through a read of the machine that failed', async () => {
        const run = steps({ engineAnswers: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true) })
        expect(await setUpWorkspace(run, live, FAST)).toBe('ready')
    })

    it('fails when the machine could not be claimed', async () => {
        const run = steps({ claimEngine: jest.fn().mockRejectedValue(new ApiError(503, 'No machine')) })
        expect(await setUpWorkspace(run, live, FAST)).toBe('failed')
    })

    it('closes nothing once the screen is gone', async () => {
        const run = steps()
        expect(await setUpWorkspace(run, () => false, FAST)).toBe('left')
        expect(run.finish).not.toHaveBeenCalled()
    })
})
