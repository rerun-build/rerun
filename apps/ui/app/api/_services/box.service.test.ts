import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const state = vi.hoisted(() => ({
    agentCounts: [] as number[],
    boundaries: [] as string[],
    detachError: null as { message: string } | null,
    calls: [] as string[],
}))

vi.mock('@/app/api/_auth/access', () => ({ BOX_NOT_FOUND: 'boxNotFound', assertSpaceAccess: async () => ({}), isAdminActor: () => true }))
vi.mock('@/app/api/_services/naming.service', () => ({ ensureWorkspaceNamed: vi.fn(), resolveBoxName: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ ensureWorkspaceEngine: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({
    selectCount: async () => ({ data: state.agentCounts.shift() ?? 0, error: null }),
    selectMany: async () => {
        const boundary = state.boundaries.shift()
        return { data: boundary ? [{ created_at: boundary }] : [], error: null }
    },
}))

function detached(call: string) {
    state.calls.push(call)
    return { error: state.detachError }
}

vi.mock('@/supabase/serviceRole', () => ({
    createServiceRoleClient: () => ({
        from: (table: string) => ({
            update: () => ({
                eq: () => ({
                    lte: async (_column: string, until: string) => detached(`detach until ${until}`),
                    then: (resolve: (value: { error: { message: string } | null }) => void) => resolve(detached('detach rest')),
                }),
            }),
            delete: () => ({
                eq: async () => {
                    state.calls.push(`delete ${table}`)
                    return { error: null }
                },
            }),
        }),
    }),
}))

const { deleteBox } = await import('./box.service')

const actor: Actor = { kind: 'workspace', workspaceId: 1 }

describe('deleting a Box', () => {
    beforeEach(() => {
        state.agentCounts = []
        state.boundaries = []
        state.detachError = null
        state.calls = []
    })

    it('detaches its notifications by batches before deleting it, so the delete has nothing left to rewrite', async () => {
        state.boundaries = ['t1', 't2']
        await deleteBox(actor, 'box')
        expect(state.calls).toEqual(['detach until t1', 'detach until t2', 'detach rest', 'delete spaces'])
    })

    it('keeps the Box when its notifications cannot be detached', async () => {
        state.detachError = { message: 'canceling statement due to statement timeout' }
        await expect(deleteBox(actor, 'box')).rejects.toMatchObject({ code: 'deleteBoxFailedBecause' })
        expect(state.calls).not.toContain('delete spaces')
    })

    it('touches nothing while the Box still holds coworkers', async () => {
        state.agentCounts = [2]
        await expect(deleteBox(actor, 'box')).rejects.toMatchObject({ code: 'boxStillHoldsCoworkers' })
        expect(state.calls).toEqual([])
    })

    it('keeps the Box when a coworker moved into it while its notifications were being detached', async () => {
        state.agentCounts = [0, 1]
        state.boundaries = ['t1']
        await expect(deleteBox(actor, 'box')).rejects.toMatchObject({ code: 'boxStillHoldsCoworkers' })
        expect(state.calls).toEqual(['detach until t1', 'detach rest'])
    })
})
