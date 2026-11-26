import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { patchAgent } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'

import { changeAgentHandle, renameAgent } from './agent.service'

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
vi.mock('./space.service', () => ({ getSpaceConnection: vi.fn().mockResolvedValue('conn') }))
vi.mock('./workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn().mockResolvedValue('conn') }))

describe('renameAgent', () => {
    const update = vi.fn()
    const eq = vi.fn()

    function siblings(rows: { id: string; handle: string }[]) {
        vi.mocked(selectMany).mockResolvedValue({ data: rows } as never)
    }

    beforeEach(() => {
        vi.clearAllMocks()
        eq.mockResolvedValue({ error: null })
        update.mockReturnValue({ eq })
        vi.mocked(createServiceRoleClient).mockReturnValue({ from: () => ({ update }) } as never)
        vi.mocked(selectSingle).mockResolvedValue({ data: { workspace_id: 7, kind: 'coworker', engine_agent_id: 'eng1', handle: 'scout' } } as never)
    })

    it('moves the handle with the name, on both sides', async () => {
        siblings([{ id: 'a1', handle: 'scout' }])

        await expect(renameAgent('a1', 'Ranger')).resolves.toEqual({ name: 'Ranger', handle: 'ranger', handleChanged: true })
        expect(update).toHaveBeenCalledWith({ name: 'Ranger', handle: 'ranger' })
        expect(patchAgent).toHaveBeenCalledWith('conn', 'eng1', { name: 'ranger', displayName: 'Ranger' })
        expect(vi.mocked(patchAgent).mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0])
    })

    it('writes nothing in Supabase when the engine refuses the rename', async () => {
        siblings([{ id: 'a1', handle: 'scout' }])
        vi.mocked(patchAgent).mockRejectedValueOnce(new Error('engine down'))

        await expect(renameAgent('a1', 'Ranger')).rejects.toThrow('engine down')
        expect(update).not.toHaveBeenCalled()
    })

    it('keeps its own handle when only the case changes', async () => {
        siblings([{ id: 'a1', handle: 'scout' }])

        await expect(renameAgent('a1', 'SCOUT')).resolves.toEqual({ name: 'SCOUT', handle: 'scout', handleChanged: false })
    })

    it('takes a suffix when another coworker already answers to the name', async () => {
        siblings([
            { id: 'a1', handle: 'scout' },
            { id: 'a2', handle: 'ranger' },
        ])

        await expect(renameAgent('a1', 'Ranger')).resolves.toEqual({ name: 'Ranger', handle: 'ranger_2', handleChanged: true })
    })

    it('leaves `foreman` to the Chief of Staff, which answers to it without a row holding it', async () => {
        siblings([{ id: 'a1', handle: 'scout' }])

        await expect(renameAgent('a1', 'Foreman')).resolves.toEqual({ name: 'Foreman', handle: 'foreman_2', handleChanged: true })
    })
})

describe('changeAgentHandle', () => {
    const update = vi.fn()
    const eq = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        eq.mockResolvedValue({ error: null })
        update.mockReturnValue({ eq })
        vi.mocked(createServiceRoleClient).mockReturnValue({ from: () => ({ update }) } as never)
        vi.mocked(selectSingle).mockResolvedValue({ data: { workspace_id: 7, kind: 'coworker', engine_agent_id: 'eng1', name: 'Scout', handle: 'scout' } } as never)
        vi.mocked(selectMany).mockResolvedValue({ data: [{ id: 'a1', handle: 'scout' }] } as never)
    })

    it('writes nothing in Supabase when the engine refuses the handle', async () => {
        vi.mocked(patchAgent).mockRejectedValueOnce(new Error('engine down'))

        await expect(changeAgentHandle('a1', 'ranger')).rejects.toThrow('engine down')
        expect(update).not.toHaveBeenCalled()
    })

    it('refuses `foreman`, the handle of the Chief of Staff', async () => {
        await expect(changeAgentHandle('a1', 'Foreman')).rejects.toMatchObject({ code: 'handleTaken' })
        expect(patchAgent).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
    })
})
