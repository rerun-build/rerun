import { workspaceActor } from '@/app/api/_auth/access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSchedule, getAgent, listConnections, patchAgent, setBoxDefault, updateSchedule, updateTrigger } from '@/lib/engine/client'
import type { BoxConnection, EngineAgentDetail } from '@/lib/engine/types'

import { resolveAgentTarget } from './chat.service'
import { dispatchAccountTool } from './mcp-account.service'
import { getWorkspaceConnection } from './workspace-engine.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('@/lib/triggers/webhook', () => ({ MAX_TRIGGER_BODY_BYTES: 1, triggerWebhookUrl: vi.fn(async () => 'https://hook') }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ NoEngineError: class NoEngineError extends Error {}, getWorkspaceConnection: vi.fn() }))
vi.mock('./agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn() }))
vi.mock('./agent-setup.service', () => ({ installServiceSlugs: vi.fn() }))
vi.mock('./services.service', () => ({ listCatalogServices: vi.fn(), listInstalledServices: vi.fn(), searchCatalogServices: vi.fn(), uninstallService: vi.fn() }))
vi.mock('./mcp-shares.service', () => ({ dispatchShareTool: vi.fn() }))

const WORKSPACE_ID = 7
const CONN = { baseUrl: 'http://engine', apiKey: null }

function connection(id: string, name: string, provider: BoxConnection['provider'], models: string[], connected = true): BoxConnection {
    return { id, name, provider, models, extraModels: [], createdAt: '2026-01-01T00:00:00.000Z', connected, credentialRejected: false, planLimits: null, cliModels: null, providerModels: null, discoveredModels: null }
}

const CONNECTIONS = [connection('codex-clem', 'Codex Clem', 'codex', ['gpt-6-sol']), connection('claude-clem', 'Claude Clem', 'claude', ['claude-opus-5-5']), connection('claude-rerun', 'Rerun (person@example.com)', 'claude', ['claude-opus-5-5'])]

function detail(resolvedConnectionId: string, model: string | null): EngineAgentDetail {
    return { config: { model, provider: 'claude' }, resolvedConnectionId, resolvedProvider: 'claude', resolvedModel: 'claude-opus-5-5' } as EngineAgentDetail
}

describe('dispatchAccountTool, what a coworker runs on', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: CONN, engineAgentId: 'engine-agent', contentLocked: false })
        vi.mocked(getWorkspaceConnection).mockResolvedValue(CONN)
        vi.mocked(listConnections).mockResolvedValue({ connections: CONNECTIONS, default: { connectionId: 'claude-rerun', model: 'claude-opus-5-5' } })
    })

    it('lists the connections with the one that holds the default', async () => {
        await expect(dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'list_ai_connections', {})).resolves.toEqual({
            default: { connectionId: 'claude-rerun', model: 'claude-opus-5-5', connectionName: 'Rerun (person@example.com)' },
            connections: [
                { id: 'codex-clem', name: 'Codex Clem', provider: 'codex', models: ['gpt-6-sol'], connected: true, isDefault: false },
                { id: 'claude-clem', name: 'Claude Clem', provider: 'claude', models: ['claude-opus-5-5'], connected: true, isDefault: false },
                { id: 'claude-rerun', name: 'Rerun (person@example.com)', provider: 'claude', models: ['claude-opus-5-5'], connected: true, isDefault: true },
            ],
        })
    })

    it('moves a coworker pinned to Codex onto the Claude account it names, and reports what it runs on', async () => {
        vi.mocked(patchAgent).mockResolvedValue(detail('claude-rerun', 'claude-opus-5-5'))

        await expect(dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'update_agent', { agentId: 'agent-own', connectionId: 'claude-rerun', model: 'claude-opus-5-5' })).resolves.toMatchObject({
            runsOn: { connectionId: 'claude-rerun', connectionName: 'Rerun (person@example.com)', provider: 'claude', model: 'claude-opus-5-5', followsWorkspaceDefault: false },
        })

        expect(patchAgent).toHaveBeenCalledWith(CONN, 'engine-agent', { connectionId: 'claude-rerun', provider: 'claude', model: 'claude-opus-5-5' })
    })

    it('writes nothing when the provider alone could mean two accounts', async () => {
        await expect(dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'update_agent', { agentId: 'agent-own', name: 'Renamed', provider: 'claude', model: 'claude-opus-5-5' })).rejects.toThrow(/several claude connections/)

        expect(patchAgent).not.toHaveBeenCalled()
    })

    it('puts a coworker back on the workspace default by clearing its whole pin', async () => {
        vi.mocked(patchAgent).mockResolvedValue(detail('claude-rerun', null))

        await expect(dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'update_agent', { agentId: 'agent-own', model: null })).resolves.toMatchObject({ runsOn: { followsWorkspaceDefault: true } })

        expect(patchAgent).toHaveBeenCalledWith(CONN, 'engine-agent', { connectionId: null, provider: null, model: null })
    })

    it('reads the connection in use only for a model named alone', async () => {
        vi.mocked(getAgent).mockResolvedValue(detail('claude-rerun', 'claude-opus-5-5'))
        vi.mocked(patchAgent).mockResolvedValue(detail('claude-rerun', 'claude-opus-5-5'))

        await dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'update_agent', { agentId: 'agent-own', model: 'claude-opus-5-5' })

        expect(patchAgent).toHaveBeenCalledWith(CONN, 'engine-agent', expect.objectContaining({ connectionId: 'claude-rerun' }))
    })

    it('leaves the pin out of a patch that names none of it', async () => {
        vi.mocked(patchAgent).mockResolvedValue(detail('claude-rerun', null))

        await dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'update_agent', { agentId: 'agent-own', verbosity: 'concise' })

        expect(listConnections).not.toHaveBeenCalled()
        expect(patchAgent).toHaveBeenCalledWith(CONN, 'engine-agent', { verbosity: 'concise' })
    })

    it('sets the workspace default on a pair the workspace really holds', async () => {
        await expect(dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'set_default_model', { connectionId: 'claude-clem', model: 'claude-opus-5-5' })).resolves.toEqual({
            default: { connectionId: 'claude-clem', connectionName: 'Claude Clem', provider: 'claude', model: 'claude-opus-5-5' },
        })

        expect(setBoxDefault).toHaveBeenCalledWith(CONN, { connectionId: 'claude-clem', model: 'claude-opus-5-5' })
    })

    it('refuses a default the connection cannot serve', async () => {
        await expect(dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'set_default_model', { connectionId: 'codex-clem', model: 'claude-opus-5-5' })).rejects.toThrow(/does not serve/)

        expect(setBoxDefault).not.toHaveBeenCalled()
    })

    it('gives a scheduled task a model of its own, and takes it back on null', async () => {
        await dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'upsert_schedule', { agentId: 'agent-own', name: 'Daily', body: 'Go', cron: '0 9 * * *', connectionId: 'claude-rerun', model: 'claude-opus-5-5' })
        expect(createSchedule).toHaveBeenCalledWith(CONN, 'engine-agent', expect.objectContaining({ connectionId: 'claude-rerun', provider: 'claude', model: 'claude-opus-5-5' }))

        await dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'upsert_schedule', { agentId: 'agent-own', slug: 'daily', model: null })
        expect(updateSchedule).toHaveBeenCalledWith(CONN, 'engine-agent', 'daily', expect.objectContaining({ connectionId: null, provider: null, model: null }))
    })

    it('gives a trigger a model of its own', async () => {
        vi.mocked(updateTrigger).mockResolvedValue({ slug: 'hook', token: 't' } as never)

        await dispatchAccountTool(workspaceActor(WORKSPACE_ID), 'upsert_trigger', { agentId: 'agent-own', slug: 'hook', connectionId: 'codex-clem', model: 'gpt-6-sol' })

        expect(updateTrigger).toHaveBeenCalledWith(CONN, 'engine-agent', 'hook', expect.objectContaining({ connectionId: 'codex-clem', provider: 'codex', model: 'gpt-6-sol' }))
    })
})
