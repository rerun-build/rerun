import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readSpaceAccess, workspaceActor, type Actor } from '@/app/api/_auth/access'
import { createServiceRoleClient } from '@/supabase/serviceRole'

import { findFreeCellInSpace, moveAgentToBox } from './agent.service'

vi.mock('@/lib/engine/client', () => ({
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    duplicateAgent: vi.fn(),
    importAgentArchive: vi.fn(),
    listSchedules: vi.fn(),
    patchAgent: vi.fn(),
    updateSchedule: vi.fn(),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn(), selectSingle: vi.fn() }))
vi.mock('@/lib/copy-name', () => ({ duplicateAgentName: vi.fn() }))
vi.mock('./capacity.service', () => ({ PLAN_LIMIT_REASON: 'plan_limit', hasFreeAgentSlot: vi.fn() }))
vi.mock('./space.service', () => ({ getSpaceConnection: vi.fn() }))
vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), readSpaceAccess: vi.fn() }))

const admin = workspaceActor(1)
const member: Actor = { kind: 'user', userId: 'u2', workspaceId: 1, role: 'member', boxScope: 'all' }

describe('findFreeCellInSpace', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(selectSingle).mockResolvedValue({ data: { col_start: 0, row_start: 0, col_end: 7, row_end: 7 } } as never)
    })

    it('uses the first corner when it is free', async () => {
        vi.mocked(selectMany).mockResolvedValue({ data: [] } as never)

        await expect(findFreeCellInSpace({} as never, 'space')).resolves.toEqual({ col: 0, row: 0 })
    })

    it('continues the historical row-major scan after occupied cells', async () => {
        vi.mocked(selectMany).mockResolvedValue({ data: [{ col: 0, row: 0 }] } as never)

        await expect(findFreeCellInSpace({} as never, 'space')).resolves.toEqual({ col: 2, row: 0 })
    })
})

describe('moveAgentToBox', () => {
    const update = vi.fn()
    const eq = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        eq.mockResolvedValue({ error: null })
        update.mockReturnValue({ eq })
        vi.mocked(createServiceRoleClient).mockReturnValue({ from: () => ({ update }) } as never)
        vi.mocked(selectSingle).mockImplementation(((_client: unknown, table: string) =>
            Promise.resolve(table === 'agents' ? { data: { space_id: 'from', workspace_id: 1 } } : { data: { col_start: 10, row_start: 0, col_end: 17, row_end: 7 } })) as never)
        vi.mocked(selectMany).mockResolvedValue({ data: [] } as never)
        vi.mocked(readSpaceAccess).mockResolvedValue('manage')
    })

    it('moves the anchor along with the Box, so the tile is drawn where it now belongs', async () => {
        await expect(moveAgentToBox('agent', 'to', admin)).resolves.toEqual({ ok: true, position: { col: 10, row: 0 } })
        expect(update).toHaveBeenCalledWith({ space_id: 'to', col: 10, row: 0 })
    })

    it('refuses a full Box rather than leaving the agent unplaced', async () => {
        vi.mocked(selectMany).mockResolvedValue({ data: [{ col: 10, row: 0 }, { col: 12, row: 0 }, { col: 14, row: 0 }, { col: 16, row: 0 }] } as never)
        vi.mocked(selectSingle).mockImplementation(((_client: unknown, table: string) =>
            Promise.resolve(table === 'agents' ? { data: { space_id: 'from', workspace_id: 1 } } : { data: { col_start: 10, row_start: 0, col_end: 17, row_end: 1 } })) as never)

        await expect(moveAgentToBox('agent', 'to', admin)).resolves.toEqual({ ok: false, error: 'That Box has no room left. Free a cell in it first.', code: 'boxFull' })
        expect(update).not.toHaveBeenCalled()
    })

    it('refuses the Box the agent is already in', async () => {
        await expect(moveAgentToBox('agent', 'from', admin)).resolves.toEqual({ ok: false, error: 'This coworker is already in that Box', code: 'coworkerAlreadyInBox' })
        expect(update).not.toHaveBeenCalled()
    })

    it('refuses a member who does not manage both Boxes, before touching the row', async () => {
        vi.mocked(readSpaceAccess).mockImplementation(async (_actor, spaceId) => (spaceId === 'from' ? 'manage' : 'use'))
        await expect(moveAgentToBox('agent', 'to', member)).resolves.toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })

        vi.mocked(readSpaceAccess).mockImplementation(async (_actor, spaceId) => (spaceId === 'from' ? 'manage' : 'none'))
        await expect(moveAgentToBox('agent', 'to', member)).resolves.toEqual({ ok: false, error: 'Box not found', code: 'boxNotFound' })
        expect(update).not.toHaveBeenCalled()
    })

    it('refuses a coworker of another workspace', async () => {
        await expect(moveAgentToBox('agent', 'to', workspaceActor(2))).resolves.toEqual({ ok: false, error: 'Coworker not found', code: 'coworkerNotFound' })
        expect(update).not.toHaveBeenCalled()
    })
})
