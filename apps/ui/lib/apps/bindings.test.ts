import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteTrigger, getAgent, patchMcpServers } from '@/lib/engine/client'
import { readRegistry, upsertRegistryEntry } from '@/lib/services/registry'
import { fakeSupabase, tableResolver } from '@/test/supabase-fake'
import { syncAppConnector, unbindAgent, unbindConnection } from './bindings'

const conn = { baseUrl: 'https://engine.test', apiKey: null }

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn(async () => conn) }))
vi.mock('@/lib/engine/client', () => ({ deleteTrigger: vi.fn(async () => {}), getAgent: vi.fn(), patchMcpServers: vi.fn() }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(), upsertRegistryEntry: vi.fn() }))

const URL_OF_APP = '${RERUN_HUB_BASE_URL}/api/mcp/apps/linkedin'
const AGENTS = [
    { id: 'alice', workspace_id: 7, engine_agent_id: 'e-alice' },
    { id: 'bob', workspace_id: 7, engine_agent_id: 'e-bob' },
]
const CONNECTIONS = [
    { id: 'conn-a', workspace_id: 7, label: 'Ada', status: 'connected' },
    { id: 'conn-b', workspace_id: 7, label: 'Bea', status: 'needs_reconnect' },
    { id: 'conn-gone', workspace_id: 7, label: 'Gone', status: 'deleted' },
]
const bound = (agent_id: string, connection_id: string, trigger_slug: string | null = null) => ({ agent_id, app_slug: 'linkedin', connection_id, trigger_slug, created_at: connection_id })

function workspace(bindings: object[]) {
    return fakeSupabase(tableResolver({ agents: AGENTS, app_connections: CONNECTIONS, app_connection_agents: bindings }))
}

function deleted(supabase: ReturnType<typeof workspace>) {
    return supabase.writes('app_connection_agents').filter(write => write.method === 'delete').map(write => Object.fromEntries(write.filters.map(filter => filter.args as [string, unknown])))
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readRegistry).mockResolvedValue({ services: { 'linkedin-pro': { status: 'needs_auth', app: { appSlug: 'linkedin', serverName: 'linkedin_pro', accountLabel: 'Old' } } } } as never)
    vi.mocked(getAgent).mockResolvedValue({ config: { mcpServers: [{ name: 'other', url: 'https://other.test' }, { name: 'linkedin_pro', url: URL_OF_APP, headers: { 'x-rerun-agent': 'e-alice' } }] } } as never)
})

describe('syncAppConnector', () => {
    const dialedAt = () => vi.mocked(patchMcpServers).mock.calls.at(-1)?.[2].upsert?.[0].url

    it('marks the connector active with the accounts held, and has the engine read its tools again', async () => {
        await expect(syncAppConnector(workspace([bound('alice', 'conn-a'), bound('alice', 'conn-b'), bound('alice', 'conn-gone')]).client, 'alice', 'linkedin')).resolves.toBe(2)

        expect(upsertRegistryEntry).toHaveBeenCalledWith(conn, 'e-alice', 'linkedin-pro', expect.objectContaining({ status: 'active', app: { appSlug: 'linkedin', serverName: 'linkedin_pro', accountLabel: 'Ada, Bea' } }))
        expect(patchMcpServers).toHaveBeenCalledWith(conn, 'e-alice', { upsert: [expect.objectContaining({ name: 'linkedin_pro', headers: { 'x-rerun-agent': 'e-alice' } })] })
        expect(dialedAt()).toMatch(/^\$\{RERUN_HUB_BASE_URL\}\/api\/mcp\/apps\/linkedin\?accounts=[0-9a-f]{12}$/)
    })

    it('dials another address for another set of accounts, and the same one for the same set', async () => {
        const sync = async (...ids: string[]) => {
            await syncAppConnector(workspace(ids.map(id => bound('alice', id))).client, 'alice', 'linkedin')
            return dialedAt()
        }
        const one = await sync('conn-a')
        const two = await sync('conn-a', 'conn-b')
        vi.mocked(getAgent).mockResolvedValue({ config: { mcpServers: [{ name: 'linkedin_pro', url: two }] } } as never)
        expect(new Set([one, two, await sync('conn-b')]).size).toBe(3)
        expect(await sync('conn-a')).toBe(one)
    })

    it('sends the connector back to its sign-in when no account is left, and leaves an app that is not installed alone', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { 'linkedin-pro': { status: 'active', app: { appSlug: 'linkedin', serverName: 'linkedin_pro', accountLabel: 'Ada' } } } } as never)
        await expect(syncAppConnector(workspace([]).client, 'alice', 'linkedin')).resolves.toBe(0)
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3]).toMatchObject({ status: 'needs_auth', app: { appSlug: 'linkedin', serverName: 'linkedin_pro' } })
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3].app).not.toHaveProperty('accountLabel')

        vi.mocked(upsertRegistryEntry).mockClear()
        vi.mocked(readRegistry).mockResolvedValue({ services: {} })
        await syncAppConnector(workspace([bound('alice', 'conn-a')]).client, 'alice', 'linkedin')
        expect(upsertRegistryEntry).not.toHaveBeenCalled()
    })
})

describe('unbindConnection', () => {
    it('takes the account off every coworker, with its own wake-ups and nothing else', async () => {
        const supabase = workspace([bound('alice', 'conn-a', 'linkedin-events'), bound('alice', 'conn-b', 'linkedin-events-bea'), bound('bob', 'conn-a')])
        await unbindConnection(supabase.client, 7, 'conn-a', 'linkedin')

        expect(vi.mocked(deleteTrigger).mock.calls).toEqual([[conn, 'e-alice', 'linkedin-events']])
        expect(deleted(supabase)).toEqual([
            { agent_id: 'alice', connection_id: 'conn-a' },
            { agent_id: 'bob', connection_id: 'conn-a' },
        ])
    })

    it('leaves the connector of a coworker that holds another account active, and the one of a coworker that held only this one to sign in', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { 'linkedin-pro': { status: 'active', app: { appSlug: 'linkedin', serverName: 'linkedin_pro' } } } } as never)
        await unbindConnection(workspace([bound('alice', 'conn-a'), bound('alice', 'conn-gone'), bound('bob', 'conn-gone')]).client, 7, 'conn-gone', 'linkedin')
        expect(vi.mocked(upsertRegistryEntry).mock.calls.map(([, engineAgentId, , entry]) => [engineAgentId, entry.status])).toEqual([['e-alice', 'active'], ['e-bob', 'needs_auth']])
    })

    it('goes through even when a box cannot be reached', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(readRegistry).mockRejectedValue(new Error('engine unreachable'))
        const supabase = workspace([bound('alice', 'conn-a'), bound('bob', 'conn-a')])
        await unbindConnection(supabase.client, 7, 'conn-a', 'linkedin')
        expect(deleted(supabase)).toHaveLength(2)
        warn.mockRestore()
    })
})

describe('unbindAgent', () => {
    it('takes every account of the app off the coworker, with all its wake-ups', async () => {
        const supabase = workspace([bound('alice', 'conn-a', 'linkedin-events'), bound('alice', 'conn-b', 'linkedin-events-bea'), bound('bob', 'conn-a', 'linkedin-events')])
        await unbindAgent(supabase.client, 7, 'alice', 'linkedin')
        expect(vi.mocked(deleteTrigger).mock.calls.map(call => call.slice(1))).toEqual([['e-alice', 'linkedin-events'], ['e-alice', 'linkedin-events-bea']])
        expect(deleted(supabase)).toEqual([{ agent_id: 'alice', app_slug: 'linkedin' }])
    })
})
