import { sleep } from '@rerun/contracts'

import { ApiError } from '@/api/client'

export type SetupSteps = {
    startWorkspace: () => Promise<boolean>
    claimEngine: () => Promise<void>
    engineAnswers: () => Promise<boolean>
    finish: () => Promise<void>
}

// `blocked`: the workspace cannot be started from the app, only the web takes it further.
// `refused`: the hub turned the start away, which is what it does when no machine is left.
export type SetupOutcome = 'ready' | 'blocked' | 'refused' | 'failed' | 'left'

const ENGINE_PATIENCE_MS = 90_000
const ENGINE_POLL_MS = 2_000

// What the welcome page does after its questions, in the same order: the workspace is started, its
// machine claimed and waited for, then the onboarding is closed. Every step can be run again.
export async function setUpWorkspace(steps: SetupSteps, live: () => boolean, { patienceMs = ENGINE_PATIENCE_MS, pollMs = ENGINE_POLL_MS } = {}): Promise<SetupOutcome> {
    try {
        if (!(await steps.startWorkspace())) return 'blocked'
        await steps.claimEngine()
        const deadline = Date.now() + patienceMs
        while (live() && !(await steps.engineAnswers().catch(() => false))) {
            if (Date.now() > deadline) return 'failed'
            await sleep(pollMs)
        }
        if (!live()) return 'left'
        await steps.finish()
        return 'ready'
    } catch (error) {
        return error instanceof ApiError && error.status === 409 ? 'refused' : 'failed'
    }
}
