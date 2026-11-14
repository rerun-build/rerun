import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForemanState } from './phase'

let row: { finished: boolean; result: unknown; claimedAt?: string } | null = null
let claims = 0
const claimBuild = vi.fn(async () => {
    if (row && !row.finished) return null
    const previous = row?.result ?? null
    const claimedAt = `claim-${++claims}`
    row = { finished: false, result: previous, claimedAt }
    return { previous, claimedAt }
})
const releaseBuild = vi.fn(async (_workspaceId: number, claimedAt: string, result: unknown) => {
    if (row?.claimedAt !== claimedAt) return
    row = { finished: true, result, claimedAt }
})
const finishedBuild = vi.fn(async () => (row?.finished ? { result: row.result } : null))
const buildTeam = vi.fn()

vi.mock('./build-claim', () => ({ claimBuild, releaseBuild, finishedBuild }))
vi.mock('./build-team', () => ({ buildTeam, titleOf: (item: { name: string }) => item.name }))

const { buildTeamOnce, BUILD_STILL_RUNNING } = await import('./build-once')

const CTX = { workspace: { id: 20415 }, userId: 'user-1' } as never
const PLAN = { title: 'Spinabot', boxes: [{ name: 'Product' }], items: [{ kind: 'agent' as const, name: 'Executive Assistant', role: 'Runs the inbox', box: 'Product' }] }
const state = (phase: ForemanState['phase'] = 'build') => ({ phase, foreman: { plan: PLAN } }) as unknown as ForemanState

const BUILT = { boxes: [{ boxId: 'box-1', name: 'Product' }], agents: [{ agentId: 'agent-1', name: 'Executive Assistant', boxId: 'box-1', active: true, lead: true }], failed: [], lead: { agentId: 'agent-1', name: 'Executive Assistant' } }
const DONE_TASKS = [{ title: 'Executive Assistant', status: 'done', steps: 1 }]
const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function once(emit: (tasks: unknown[]) => void = () => {}, reload = async () => state()) {
    return buildTeamOnce({ ctx: CTX, state: state(), emit, reload, pollMs: 2, timeoutMs: 500 })
}

describe('buildTeamOnce', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        row = null
        buildTeam.mockImplementation(async ({ emit }: { emit: (tasks: unknown[]) => void }) => {
            await tick(20)
            emit(DONE_TASKS)
            return BUILT
        })
    })

    it('builds once when two requests arrive together, and both answer with the team that was built', async () => {
        const waiterTasks: unknown[][] = []
        const [first, second] = await Promise.all([once(), once(tasks => waiterTasks.push(tasks))])

        expect(buildTeam).toHaveBeenCalledTimes(1)
        expect(first).toEqual(BUILT)
        expect(second).toEqual(BUILT)
        expect(waiterTasks[0]).toMatchObject([{ title: 'Executive Assistant', status: 'running' }])
        expect(waiterTasks.at(-1)).toEqual(DONE_TASKS)
    })

    it('builds on the state read once the build is its own, not the one the request started with', async () => {
        const fresh = { ...state(), spaces: [{ id: 'box-1', name: 'Product' }] } as unknown as ForemanState
        await once(undefined, async () => fresh)
        expect(buildTeam).toHaveBeenCalledWith(expect.objectContaining({ state: fresh }))
    })

    it('runs the build again when the one it waited on landed no coworker', async () => {
        const STOPPED = { ...BUILT, agents: [], lead: null }
        buildTeam.mockImplementationOnce(async () => {
            await tick(20)
            return STOPPED
        })
        const [first, second] = await Promise.all([once(), once()])

        expect(buildTeam).toHaveBeenCalledTimes(2)
        expect(first).toEqual(STOPPED)
        expect(second).toEqual(BUILT)
    })

    it('answers with the build that just landed when there is nothing left to build once it claims', async () => {
        row = { finished: true, result: { result: BUILT, tasks: DONE_TASKS } }
        const emitted: unknown[][] = []
        const result = await once(tasks => emitted.push(tasks), async () => state('companion'))

        expect(buildTeam).not.toHaveBeenCalled()
        expect(result).toEqual(BUILT)
        expect(emitted).toEqual([DONE_TASKS])
        expect(row).toMatchObject({ finished: true, result: { result: BUILT, tasks: DONE_TASKS } })
    })

    it('releases the workspace when the build throws, so the next request can build', async () => {
        buildTeam.mockRejectedValueOnce(new Error('No Box could be created'))
        await expect(once()).rejects.toThrow('No Box could be created')
        expect(row).toMatchObject({ finished: true, result: null })

        await expect(once()).resolves.toEqual(BUILT)
    })

    it('leaves the claim alone when its own was taken over while it built', async () => {
        buildTeam.mockImplementationOnce(async () => {
            row = { finished: false, result: null, claimedAt: 'taken-over' }
            return BUILT
        })
        await expect(once()).resolves.toEqual(BUILT)
        expect(row).toEqual({ finished: false, result: null, claimedAt: 'taken-over' })
    })

    it('gives up waiting on a build that never finishes, with a message rather than a second build', async () => {
        row = { finished: false, result: null }
        await expect(buildTeamOnce({ ctx: CTX, state: state(), emit: () => {}, reload: async () => state(), pollMs: 2, timeoutMs: 20 })).rejects.toThrow(BUILD_STILL_RUNNING)
        expect(buildTeam).not.toHaveBeenCalled()
    })
})
