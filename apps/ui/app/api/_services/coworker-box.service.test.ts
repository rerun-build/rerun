import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ agents: [] as { engine_agent_id: string | null; space_id: string }[], sent: [] as unknown[], down: false, readFails: false }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: async () => (state.readFails ? { data: null, error: { message: 'read failed' } } : { data: state.agents, error: null }) }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: async () => ({ host: 'engine' }) }))
vi.mock('@/lib/engine/client', () => ({
    setBrainAgentBoxes: async (_conn: unknown, boxes: unknown) => {
        if (state.down) throw new Error('engine down')
        state.sent.push(boxes)
    },
}))

const { syncCoworkerBoxes } = await import('./coworker-box.service')

describe('the Boxes of the coworkers on the engine', () => {
    beforeEach(() => {
        state.sent = []
        state.down = false
        state.readFails = false
    })

    it('sends the whole map by engine agent id, leaving out a coworker the engine does not know', async () => {
        state.agents = [
            { engine_agent_id: 'e1', space_id: 'sales' },
            { engine_agent_id: null, space_id: 'sales' },
            { engine_agent_id: 'e2', space_id: 'support' },
        ]
        await syncCoworkerBoxes(1)
        expect(state.sent).toEqual([{ e1: 'sales', e2: 'support' }])
    })

    it('leaves the engine\'s map as it was when the coworkers cannot be read', async () => {
        state.readFails = true
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await syncCoworkerBoxes(1)
        expect(state.sent).toEqual([])
    })

    it('never fails the gesture it follows when the engine is down', async () => {
        state.down = true
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(syncCoworkerBoxes(1)).resolves.toBeUndefined()
    })
})
