import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSchedule, createTrigger, importSkill, patchAgent, updateSchedule, updateTrigger } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

import type { ServiceManifest } from '@/lib/services/manifest'
import type { InstalledService } from '@/lib/services/types'

import { changeAgentHandle, createAgent, deleteAgent, renameAgent } from './agent.service'
import { LOCKED_WRITE_ERROR } from './agent-content.service'
import { declareService } from './agent-setup.service'
import { resolveAgentTarget } from './chat.service'
import { dispatchAccountTool } from './mcp-account.service'
import { allocateServiceInstance, listInstalledServices, loadManifest, uninstallService } from './services.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), getConnectionForAgent: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('./agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn() }))
vi.mock('./agent-setup.service', () => ({ declareService: vi.fn(), installServiceSlugs: vi.fn() }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('./services.service', () => ({
    allocateServiceInstance: vi.fn(),
    listCatalogServices: vi.fn(),
    listInstalledServices: vi.fn(),
    loadManifest: vi.fn(),
    searchCatalogServices: vi.fn(),
    toAuthMethodSummaries: vi.fn(() => []),
    uninstallService: vi.fn(),
}))
vi.mock('./mcp-shares.service', () => ({ dispatchShareTool: vi.fn() }))

const WORKSPACE_ID = 7
const FOREIGN_WORKSPACE_ID = 99

const AGENTS: Record<string, Record<string, unknown>> = {
    'agent-own': { workspace_id: WORKSPACE_ID },
    'agent-foreign': { workspace_id: FOREIGN_WORKSPACE_ID },
    'agent-sealed': { workspace_id: WORKSPACE_ID },
}

const SPACES = [
    { id: 'box-own', name: 'Sales', workspace_id: WORKSPACE_ID },
    { id: 'box-foreign', name: 'Theirs', workspace_id: FOREIGN_WORKSPACE_ID },
]

function gmailManifest(multiInstance: boolean): ServiceManifest {
    return { slug: 'gmail', name: 'Gmail', multiInstance } as ServiceManifest
}

function installed(key: string, label?: string): InstalledService {
    const [slug, instanceId] = key.split('@')
    return { key, slug, ...(instanceId ? { instanceId } : {}), ...(label ? { label } : {}), name: 'Gmail', icon: null, category: 'productivity', status: 'needs_auth', toolNames: [], installedAt: '2026-10-23T00:00:00.000Z' }
}

function eqValue(calls: readonly SupabaseCall[], column: string): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
}

function resolveRow(table: string, calls: readonly SupabaseCall[]) {
    if (table === 'agents') return { data: AGENTS[eqValue(calls, 'id') as string] ?? null }
    if (table === 'spaces') return { data: SPACES.filter(space => space.workspace_id === eqValue(calls, 'workspace_id')) }
    return undefined
}

describe('dispatchAccountTool', () => {
    let db: FakeSupabase

    beforeEach(() => {
        vi.clearAllMocks()
        db = fakeSupabase(resolveRow)
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    })

    describe('delete_agent', () => {
        it('refuses to delete without an explicit confirmation', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'delete_agent', { agentId: 'agent-own' })).rejects.toThrow(/confirm: true/)
            await expect(dispatchAccountTool(WORKSPACE_ID, 'delete_agent', { agentId: 'agent-own', confirm: 'yes' })).rejects.toThrow(/confirm: true/)

            expect(deleteAgent).not.toHaveBeenCalled()
        })

        it('refuses an agent of another workspace even when confirmed', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'delete_agent', { agentId: 'agent-foreign', confirm: true })).rejects.toThrow('Coworker not found')

            expect(deleteAgent).not.toHaveBeenCalled()
        })

        it('refuses an agent that does not exist', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'delete_agent', { agentId: 'agent-missing', confirm: true })).rejects.toThrow('Coworker not found')

            expect(deleteAgent).not.toHaveBeenCalled()
        })

        it('deletes a confirmed agent of the workspace', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'delete_agent', { agentId: 'agent-own', confirm: true })).resolves.toEqual({ agentId: 'agent-own', deleted: true })

            expect(deleteAgent).toHaveBeenCalledWith('agent-own')
        })
    })

    describe('create_agent', () => {
        it('refuses a Box of another workspace', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'create_agent', { name: 'Scout', spaceId: 'box-foreign' })).rejects.toThrow('Box not found')

            expect(eqValue(db.chainsOn('spaces')[0], 'workspace_id')).toBe(WORKSPACE_ID)
            expect(createAgent).not.toHaveBeenCalled()
        })

        it('creates the agent in the Box of the workspace it names', async () => {
            vi.mocked(createAgent).mockResolvedValue({ id: 'agent-new', name: 'Scout', handle: 'scout', disabled_at: null } as never)

            await expect(dispatchAccountTool(WORKSPACE_ID, 'create_agent', { name: 'Scout', spaceId: 'box-own' })).resolves.toMatchObject({ agentId: 'agent-new', spaceId: 'box-own', active: true })

            expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID, spaceId: 'box-own' }))
        })
    })

    describe('connectors', () => {
        const NEW_ACCOUNT = { key: 'gmail@k3x9ab', instanceId: 'k3x9ab', label: 'Gmail 2' }

        beforeEach(() => {
            vi.mocked(resolveAgentTarget).mockResolvedValue({} as never)
            vi.mocked(declareService).mockResolvedValue('compiled')
            vi.mocked(allocateServiceInstance).mockResolvedValue(NEW_ACCOUNT)
            vi.mocked(listInstalledServices).mockResolvedValue({ services: [installed('gmail', 'me@work.com'), installed('gmail@k3x9ab', 'Gmail 2')] })
        })

        it('lists one row per account, keyed', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'list_agent_connectors', { agentId: 'agent-own' })).resolves.toEqual({
                connectors: [
                    { key: 'gmail', slug: 'gmail', name: 'Gmail', label: 'me@work.com', status: 'needs_auth', toolNames: [] },
                    { key: 'gmail@k3x9ab', slug: 'gmail', name: 'Gmail', label: 'Gmail 2', status: 'needs_auth', toolNames: [] },
                ],
            })
        })

        it('declares the base account without newInstance', async () => {
            vi.mocked(loadManifest).mockResolvedValue(gmailManifest(true))

            await expect(dispatchAccountTool(WORKSPACE_ID, 'attach_connector', { agentId: 'agent-own', slug: 'gmail' })).resolves.toMatchObject({ key: 'gmail', slug: 'gmail', label: 'me@work.com' })

            expect(allocateServiceInstance).not.toHaveBeenCalled()
            expect(declareService).toHaveBeenCalledWith('agent-own', gmailManifest(true), WORKSPACE_ID, undefined)
        })

        it('declares another account of an app that supports several', async () => {
            vi.mocked(loadManifest).mockResolvedValue(gmailManifest(true))

            await expect(dispatchAccountTool(WORKSPACE_ID, 'attach_connector', { agentId: 'agent-own', slug: 'gmail', newInstance: true })).resolves.toMatchObject({
                key: 'gmail@k3x9ab',
                slug: 'gmail',
                label: 'Gmail 2',
                status: 'needs_auth',
            })

            expect(declareService).toHaveBeenCalledWith('agent-own', gmailManifest(true), WORKSPACE_ID, NEW_ACCOUNT)
        })

        it('ignores newInstance on an app limited to one account', async () => {
            vi.mocked(loadManifest).mockResolvedValue(gmailManifest(false))

            await expect(dispatchAccountTool(WORKSPACE_ID, 'attach_connector', { agentId: 'agent-own', slug: 'gmail', newInstance: true })).resolves.toMatchObject({ key: 'gmail' })

            expect(allocateServiceInstance).not.toHaveBeenCalled()
            expect(declareService).toHaveBeenCalledWith('agent-own', gmailManifest(false), WORKSPACE_ID, undefined)
        })

        it('refuses an app the catalog does not know', async () => {
            vi.mocked(loadManifest).mockResolvedValue(null)

            await expect(dispatchAccountTool(WORKSPACE_ID, 'attach_connector', { agentId: 'agent-own', slug: 'nope' })).rejects.toThrow('Unknown app "nope"')

            expect(declareService).not.toHaveBeenCalled()
        })

        it('detaches one account by its key', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'detach_connector', { agentId: 'agent-own', key: 'gmail@k3x9ab', slug: 'gmail', confirm: true })).resolves.toEqual({ key: 'gmail@k3x9ab', detached: true })

            expect(uninstallService).toHaveBeenCalledWith('agent-own', 'gmail@k3x9ab', WORKSPACE_ID)
        })

        it('detaches the base account by its slug', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'detach_connector', { agentId: 'agent-own', slug: 'gmail', confirm: true })).resolves.toEqual({ key: 'gmail', detached: true })

            expect(uninstallService).toHaveBeenCalledWith('agent-own', 'gmail', WORKSPACE_ID)
        })
    })

    describe('template content lock', () => {
        beforeEach(() => {
            vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: { url: 'https://engine.test', apiKey: 'key' }, engineAgentId: 'engine-sealed', contentLocked: true } as never)
        })

        it('refuses update_agent writing the soul of an agent whose template content is locked', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'update_agent', { agentId: 'agent-sealed', soul: 'New soul', name: 'Renamed' })).rejects.toThrow(LOCKED_WRITE_ERROR)

            expect(patchAgent).not.toHaveBeenCalled()
            expect(renameAgent).not.toHaveBeenCalled()
        })

        it('lets update_agent change the rest of a locked agent', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'update_agent', { agentId: 'agent-sealed', description: 'Finds leads' })).resolves.toMatchObject({ updated: ['description'] })

            expect(patchAgent).toHaveBeenCalledWith(expect.anything(), 'engine-sealed', { description: 'Finds leads' })
        })

        it('refuses upsert_skill writing a skill on an agent whose template content is locked', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'upsert_skill', { agentId: 'agent-sealed', name: 'Outreach', body: 'Rewritten' })).rejects.toThrow(LOCKED_WRITE_ERROR)

            expect(importSkill).not.toHaveBeenCalled()
        })

        it('refuses upsert_schedule writing the body of a scheduled task on an agent whose template content is locked', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'upsert_schedule', { agentId: 'agent-sealed', slug: 'daily', body: 'Rewritten' })).rejects.toThrow(LOCKED_WRITE_ERROR)
            await expect(dispatchAccountTool(WORKSPACE_ID, 'upsert_schedule', { agentId: 'agent-sealed', name: 'Daily', cron: '0 9 * * *', body: 'New' })).rejects.toThrow(LOCKED_WRITE_ERROR)

            expect(updateSchedule).not.toHaveBeenCalled()
            expect(createSchedule).not.toHaveBeenCalled()
        })

        it('lets upsert_schedule pause a scheduled task of a locked agent', async () => {
            await dispatchAccountTool(WORKSPACE_ID, 'upsert_schedule', { agentId: 'agent-sealed', slug: 'daily', enabled: false })

            expect(updateSchedule).toHaveBeenCalledWith(expect.anything(), 'engine-sealed', 'daily', expect.objectContaining({ enabled: false, body: undefined }))
        })

        it('refuses upsert_trigger writing the body of a trigger on an agent whose template content is locked', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'upsert_trigger', { agentId: 'agent-sealed', slug: 'inbound', body: 'Rewritten' })).rejects.toThrow(LOCKED_WRITE_ERROR)
            await expect(dispatchAccountTool(WORKSPACE_ID, 'upsert_trigger', { agentId: 'agent-sealed', name: 'Inbound', body: 'New' })).rejects.toThrow(LOCKED_WRITE_ERROR)

            expect(updateTrigger).not.toHaveBeenCalled()
            expect(createTrigger).not.toHaveBeenCalled()
        })

        it('lets upsert_trigger disable a trigger of a locked agent', async () => {
            vi.mocked(updateTrigger).mockResolvedValue({ slug: 'inbound', name: 'Inbound', enabled: false, token: null } as never)

            await expect(dispatchAccountTool(WORKSPACE_ID, 'upsert_trigger', { agentId: 'agent-sealed', slug: 'inbound', enabled: false })).resolves.toMatchObject({ slug: 'inbound', enabled: false })

            expect(updateTrigger).toHaveBeenCalledWith(expect.anything(), 'engine-sealed', 'inbound', expect.objectContaining({ enabled: false, body: undefined }))
        })
    })

    describe('update_agent identity reporting', () => {
        beforeEach(() => {
            vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: { url: 'https://engine.test', apiKey: 'key' }, engineAgentId: 'engine-own', contentLocked: false } as never)
            vi.mocked(renameAgent).mockResolvedValue({ name: 'Worker B', handle: 'worker_b' })
            vi.mocked(changeAgentHandle).mockResolvedValue({ name: 'Worker A', handle: 'custom_key' })
        })

        it('reports the handle in updated for a handle-only update', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'update_agent', { agentId: 'agent-own', handle: 'custom_key' }))
                .resolves.toMatchObject({ agentId: 'agent-own', name: 'Worker A', handle: 'custom_key', updated: ['handle'] })

            expect(changeAgentHandle).toHaveBeenCalledWith('agent-own', 'custom_key')
            expect(renameAgent).not.toHaveBeenCalled()
        })

        it('reports the name and handle in updated for a name-only update', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'update_agent', { agentId: 'agent-own', name: 'Worker B' }))
                .resolves.toMatchObject({ agentId: 'agent-own', name: 'Worker B', handle: 'worker_b', updated: ['name', 'handle'] })

            expect(renameAgent).toHaveBeenCalledWith('agent-own', 'Worker B')
            expect(changeAgentHandle).not.toHaveBeenCalled()
        })

        it('reports identity and config fields together without duplicates', async () => {
            await expect(dispatchAccountTool(WORKSPACE_ID, 'update_agent', { agentId: 'agent-own', name: 'Worker B', handle: 'custom_key', description: 'Finds leads' }))
                .resolves.toMatchObject({ updated: ['name', 'handle', 'description'] })

            expect(renameAgent).toHaveBeenCalledWith('agent-own', 'Worker B')
            expect(changeAgentHandle).toHaveBeenCalledWith('agent-own', 'custom_key')
        })
    })
})
