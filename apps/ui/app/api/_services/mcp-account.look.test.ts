import { workspaceActor } from '@/app/api/_auth/access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { patchAgent } from '@/lib/engine/client'

import { renameAgent, setAgentLook } from './agent.service'
import { resolveAgentTarget } from './chat.service'
import { dispatchAccountTool } from './mcp-account.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('@/lib/triggers/webhook', () => ({ MAX_TRIGGER_BODY_BYTES: 1, triggerWebhookUrl: vi.fn(async () => 'https://hook') }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ NoEngineError: class NoEngineError extends Error {}, getWorkspaceConnection: vi.fn() }))
vi.mock('./agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn(), setAgentLook: vi.fn() }))
vi.mock('./agent-setup.service', () => ({ installServiceSlugs: vi.fn() }))
vi.mock('./services.service', () => ({ listCatalogServices: vi.fn(), listInstalledServices: vi.fn(), searchCatalogServices: vi.fn(), uninstallService: vi.fn() }))
vi.mock('./mcp-vault.service', () => ({ dispatchVaultTool: vi.fn() }))

const ACTOR = workspaceActor(7)
const LOOK = { eyes: 'googly', mouth: 'smile', color: '#7a2cf5' }

describe('update_agent, the look of a coworker', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: { baseUrl: 'http://engine', apiKey: null }, engineAgentId: 'engine-agent' })
    })

    it('dresses it, and gives it back its own look on null, without touching the engine', async () => {
        await expect(dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', look: LOOK })).resolves.toMatchObject({ updated: ['look'] })
        await dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', look: null })

        expect(vi.mocked(setAgentLook).mock.calls).toEqual([
            ['agent-own', LOOK],
            ['agent-own', null],
        ])
        expect(patchAgent).not.toHaveBeenCalled()
    })

    it('dresses it in a material', async () => {
        await dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', look: { ...LOOK, material: 'chrome' } })

        expect(setAgentLook).toHaveBeenCalledWith('agent-own', { ...LOOK, material: 'chrome' })
    })

    it('refuses a colour that means a state, or a part it cannot wear, before changing anything', async () => {
        await expect(dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', name: 'Renamed', look: { ...LOOK, color: '#ef4444' } })).rejects.toThrow(/color one of/)
        await expect(dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', look: { ...LOOK, eyes: 'laser' } })).rejects.toThrow(/eyes one of/)
        await expect(dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', look: { ...LOOK, material: 'velvet' } })).rejects.toThrow(/material one of/)

        expect(renameAgent).not.toHaveBeenCalled()
        expect(setAgentLook).not.toHaveBeenCalled()
    })

    it('leaves the look alone when it is not named', async () => {
        await dispatchAccountTool(ACTOR, 'update_agent', { agentId: 'agent-own', name: 'Renamed' })

        expect(setAgentLook).not.toHaveBeenCalled()
    })
})
