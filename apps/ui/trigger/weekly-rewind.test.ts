import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWorkspaceRewind } from '@/lib/rewind/build'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type SupabaseCall } from '@/test/supabase-fake'
import { runContext } from '@/test/trigger-sdk'
import { buildRewind, weeklyRewindSchedule } from './weekly-rewind'

const features = vi.hoisted(() => ({ REWIND_RELEASED: true }))

vi.mock('@trigger.dev/sdk/v3', async () => (await import('@/test/trigger-sdk')).triggerSdkMock())
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/rewind/build', () => ({ buildWorkspaceRewind: vi.fn() }))
vi.mock('@/lib/features', () => features)

const NOW = new Date('2026-09-21T05:00:00.000Z')

type Run = (payload: unknown, params: unknown) => Promise<unknown>
const runSchedule = (env: Parameters<typeof runContext>[0] = 'PRODUCTION') => ((weeklyRewindSchedule as unknown as { run: Run }).run)({}, runContext(env))
const runBuild = (payload: unknown) => ((buildRewind as unknown as { run: Run }).run)(payload, runContext())

function withRows(agentWorkspaceIds: number[], tornDownIds: number[] = []) {
    const db = fakeSupabase((table, calls: readonly SupabaseCall[]) => {
        const range = calls.find(call => call.method === 'range')
        if (range && range.args[0] !== 0) return { data: [] }
        if (table === 'agents') return { data: agentWorkspaceIds.map(workspace_id => ({ workspace_id })) }
        return { data: tornDownIds.map(id => ({ id })) }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

function dispatched() {
    return vi.mocked(buildRewind.batchTrigger).mock.calls.map(([items]) => (items as { payload: { workspaceId: number } }[]).map(item => item.payload.workspaceId))
}

describe('weeklyRewindSchedule', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        features.REWIND_RELEASED = true
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
    })
    afterEach(() => vi.useRealTimers())

    it('skips the dev environment', async () => {
        await expect(runSchedule('DEVELOPMENT')).resolves.toBeNull()
        expect(createServiceRoleClient).not.toHaveBeenCalled()
    })

    it('dispatches nothing until the feature is released', async () => {
        features.REWIND_RELEASED = false
        withRows([1])

        await expect(runSchedule()).resolves.toBeNull()
        expect(buildRewind.batchTrigger).not.toHaveBeenCalled()
    })

    it('dispatches each workspace with agents once, keyed on the week', async () => {
        withRows([1, 1, 2])

        await expect(runSchedule()).resolves.toEqual({ weekStart: '2026-09-14', workspaces: 2 })
        expect(buildRewind.batchTrigger).toHaveBeenCalledWith([
            { payload: { workspaceId: 1, weekStart: '2026-09-14' }, options: { idempotencyKey: 'rewind-1-2026-09-14' } },
            { payload: { workspaceId: 2, weekStart: '2026-09-14' }, options: { idempotencyKey: 'rewind-2-2026-09-14' } },
        ])
    })

    it('leaves out the workspaces whose Boxes were torn down', async () => {
        const db = withRows([1, 2, 3], [2])

        await runSchedule()

        expect(dispatched()).toEqual([[1, 3]])
        const [workspaces] = db.chainsOn('workspaces')
        expect(workspaces).toContainEqual({ table: 'workspaces', method: 'not', args: ['boxes_deleted_at', 'is', null] })
    })

    it('fits 500 workspaces in one batch', async () => {
        withRows(Array.from({ length: 500 }, (_, index) => index + 1))

        await runSchedule()

        expect(dispatched().map(batch => batch.length)).toEqual([500])
    })

    it('splits 501 workspaces over two batches', async () => {
        withRows(Array.from({ length: 501 }, (_, index) => index + 1))

        await runSchedule()

        expect(dispatched().map(batch => batch.length)).toEqual([500, 1])
    })
})

describe('buildRewind', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
        vi.mocked(buildWorkspaceRewind).mockResolvedValue({ agents: 1 } as never)
    })
    afterEach(() => vi.useRealTimers())

    it('builds the week asked for, snapped to its Monday', async () => {
        await runBuild({ workspaceId: 4, weekStart: '2026-09-16' })

        expect(buildWorkspaceRewind).toHaveBeenCalledWith(expect.anything(), 4, { weekStart: '2026-09-14', from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' })
    })

    it('defaults to the last completed week', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)

        await runBuild({ workspaceId: 4 })

        expect(buildWorkspaceRewind).toHaveBeenCalledWith(expect.anything(), 4, expect.objectContaining({ weekStart: '2026-09-14' }))
    })

    it('rejects an invalid weekStart before building anything', async () => {
        await expect(runBuild({ workspaceId: 4, weekStart: 'not-a-date' })).rejects.toThrow(RangeError)
        expect(buildWorkspaceRewind).not.toHaveBeenCalled()
    })
})
