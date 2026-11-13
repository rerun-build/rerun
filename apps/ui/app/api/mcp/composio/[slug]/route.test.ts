import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadManifest } from '@/app/api/_services/services.service'
import { authenticateEngineToken, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { ComposioApiError, composioUserId, deleteConnectedAccount, executeTool, listToolkitTools } from '@/lib/composio/client'
import { readRegistry, type RegistryEntry, upsertRegistryEntry } from '@/lib/services/registry'
import type { EngineConnection } from '@/lib/engine/types'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'
import { POST } from './route'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/services.service', () => ({ loadManifest: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(), upsertRegistryEntry: vi.fn() }))
vi.mock('@/lib/composio/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/composio/client')>()), executeTool: vi.fn(), listToolkitTools: vi.fn(), deleteConnectedAccount: vi.fn() }))

const BOX_KEY = 'box-key-of-workspace-7'
const WORKSPACE_ID = 7

const AGENTS = [
    { id: 'agent-own', workspace_id: WORKSPACE_ID, engine_agent_id: 'engine-own' },
    { id: 'agent-foreign', workspace_id: 99, engine_agent_id: 'engine-foreign' },
]

const manifest = serviceManifestSchema.parse({
    slug: 'gmail',
    name: 'Gmail',
    authMethods: [{ id: 'composio', kind: 'composio', composio: { toolkit: 'gmail', authConfigId: 'ac_1', allowedTools: ['GMAIL_SEND_EMAIL', 'GMAIL_LIST_THREADS'] } }],
})

function eqValue(calls: readonly SupabaseCall[], column: string): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
}

function resolve(table: string, calls: readonly SupabaseCall[]) {
    if (table !== 'agents') return undefined
    const match = AGENTS.find(agent => agent.workspace_id === eqValue(calls, 'workspace_id') && agent.engine_agent_id === eqValue(calls, 'engine_agent_id'))
    return { data: match ? { id: match.id } : null }
}

function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request('https://rerun.test/api/mcp/composio/gmail', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rerun-key': BOX_KEY, 'x-rerun-agent': 'engine-own', ...headers },
        body: JSON.stringify(body),
    })
}

function context(slug = 'gmail') {
    return { params: Promise.resolve({ slug }) }
}

function toolCall(name: string) {
    return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { to: 'a@b.c' } } }
}

describe('POST /api/mcp/composio/[slug]', () => {
    let db: FakeSupabase

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        db = fakeSupabase(resolve)
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === BOX_KEY ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
        vi.mocked(loadManifest).mockResolvedValue(manifest)
        vi.mocked(executeTool).mockResolvedValue({ successful: true, data: { id: 'msg-1' }, error: null })
    })

    it('answers 401 without an engine key and loads no manifest', async () => {
        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL'), { 'x-rerun-key': '' }), context())

        expect(response.status).toBe(401)
        expect(loadManifest).not.toHaveBeenCalled()
        expect(executeTool).not.toHaveBeenCalled()
    })

    it('answers 401 with an engine key that names no machine', async () => {
        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL'), { 'x-rerun-key': 'forged-key' }), context())

        expect(response.status).toBe(401)
        expect(authenticateEngineToken).toHaveBeenCalledWith('forged-key')
        expect(executeTool).not.toHaveBeenCalled()
    })

    it('answers 404 for a slug the catalog does not know', async () => {
        vi.mocked(loadManifest).mockResolvedValue(null)

        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL')), context('nope'))

        expect(response.status).toBe(404)
        expect(loadManifest).toHaveBeenCalledWith('nope')
    })

    it('answers 404 for a service that is not connected through Composio', async () => {
        vi.mocked(loadManifest).mockResolvedValue(serviceManifestSchema.parse({ slug: 'linear', name: 'Linear', authMethods: [{ id: 'key', kind: 'key' }] }))

        const response = await POST(request(toolCall('LINEAR_CREATE_ISSUE')), context('linear'))

        expect(response.status).toBe(404)
    })

    it('refuses a tool outside allowedTools with -32601 before touching the agent or Composio', async () => {
        const response = await POST(request(toolCall('GMAIL_DELETE_EVERYTHING')), context())

        expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unknown tool: GMAIL_DELETE_EVERYTHING' } })
        expect(db.chainsOn('agents')).toHaveLength(0)
        expect(executeTool).not.toHaveBeenCalled()
    })

    it('lists only the allowed tools of the toolkit', async () => {
        vi.mocked(listToolkitTools).mockResolvedValue([
            { slug: 'GMAIL_SEND_EMAIL', name: 'Send', description: 'Send an email', inputParameters: {} },
            { slug: 'GMAIL_DELETE_EVERYTHING', name: 'Delete', description: 'Delete all mail', inputParameters: {} },
        ])

        const response = await POST(request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), context())

        const body = await response.json()
        expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['GMAIL_SEND_EMAIL'])
    })

    it('refuses an engine agent of another workspace', async () => {
        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL'), { 'x-rerun-agent': 'engine-foreign' }), context())

        expect(await response.json()).toMatchObject({ error: { code: -32603, message: 'Coworker does not belong to the authenticated workspace' } })
        expect(eqValue(db.chainsOn('agents')[0], 'workspace_id')).toBe(WORKSPACE_ID)
        expect(executeTool).not.toHaveBeenCalled()
    })

    it('refuses a tool call that names no engine agent', async () => {
        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL'), { 'x-rerun-agent': '' }), context())

        expect(await response.json()).toMatchObject({ error: { code: -32603 } })
        expect(db.chainsOn('agents')).toHaveLength(0)
        expect(executeTool).not.toHaveBeenCalled()
    })

    it('runs the tool as the Composio user derived from the agent resolved in the workspace', async () => {
        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL')), context())

        expect(await response.json()).toMatchObject({ result: { structuredContent: { id: 'msg-1' } } })
        expect(executeTool).toHaveBeenCalledWith('GMAIL_SEND_EMAIL', composioUserId('agent-own'), { to: 'a@b.c' })
    })

    it('runs the tool as the Composio user of the instance named by x-rerun-instance', async () => {
        await POST(request(toolCall('GMAIL_SEND_EMAIL'), { 'x-rerun-instance': 'k3x9ab' }), context())

        expect(executeTool).toHaveBeenCalledWith('GMAIL_SEND_EMAIL', composioUserId('agent-own', 'k3x9ab'), { to: 'a@b.c' })
        expect(composioUserId('agent-own', 'k3x9ab')).toBe(`${composioUserId('agent-own')}_k3x9ab`)
    })

    it('answers 400 to a malformed instance id rather than acting as the base account', async () => {
        const response = await POST(request(toolCall('GMAIL_SEND_EMAIL'), { 'x-rerun-instance': '../other' }), context())

        expect(response.status).toBe(400)
        expect(executeTool).not.toHaveBeenCalled()
    })

    describe('a Composio account that is not connected', () => {
        const NO_ACCOUNT = 'No connected account found for user local_agent_agent-own and toolkit gmail'
        const conn: EngineConnection = { baseUrl: 'https://box.test', apiKey: 'k' }

        function registryWith(entry: Partial<RegistryEntry>) {
            const gmail: RegistryEntry = { config: {}, mcpServers: ['gmail'], envKeys: [], skills: [], installedAt: '2026-10-16T08:30:21Z', status: 'needs_auth', composio: { toolkit: 'gmail', serverName: 'gmail' }, ...entry }
            vi.mocked(readRegistry).mockResolvedValue({ services: { gmail } })
            return gmail
        }

        async function errorText(response: Response): Promise<string> {
            const body = await response.json()
            expect(body.result.isError).toBe(true)
            return JSON.parse(body.result.content[0].text).error
        }

        beforeEach(() => {
            vi.mocked(getWorkspaceConnection).mockResolvedValue(conn)
            vi.mocked(executeTool).mockResolvedValue({ successful: false, data: null, error: NO_ACCOUNT })
            vi.mocked(deleteConnectedAccount).mockResolvedValue()
        })

        it('tells the agent the app was never connected and to suggest it, leaving the registry alone', async () => {
            registryWith({ status: 'needs_auth' })

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toBe('Gmail is not connected yet. Call suggest_service with slug "gmail" so the user gets a Connect card, then end your turn.')
            expect(upsertRegistryEntry).not.toHaveBeenCalled()
            expect(console.warn).toHaveBeenCalledWith('[composio:gmail] tools/call GMAIL_LIST_THREADS: not connected (never):', NO_ACCOUNT)
        })

        it('tells the agent a connected account was lost and sends the entry back to needs_auth', async () => {
            const entry = registryWith({ status: 'active', composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_1', accountLabel: 'me@x.com' } })

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toBe('Gmail\'s connection expired or was revoked. Call suggest_service with slug "gmail" so the user gets a Connect card, then end your turn.')
            expect(upsertRegistryEntry).toHaveBeenCalledWith(conn, 'engine-own', 'gmail', { ...entry, status: 'needs_auth', composio: { toolkit: 'gmail', serverName: 'gmail' } })
            expect(deleteConnectedAccount).not.toHaveBeenCalled()
        })

        it('sends the instance entry back to needs_auth, and still points suggest_service at the app', async () => {
            const extra: RegistryEntry = { config: {}, mcpServers: ['gmail-k3x9ab'], envKeys: [], skills: [], installedAt: '2026-10-16T08:30:21Z', status: 'active', instanceId: 'k3x9ab', label: 'ops@x.com', composio: { toolkit: 'gmail', serverName: 'gmail-k3x9ab', connectedAccountId: 'ca_2' } }
            const base = registryWith({ status: 'active', composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_1' } })
            vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: base, 'gmail@k3x9ab': extra } })

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS'), { 'x-rerun-instance': 'k3x9ab' }), context()))

            expect(text).toMatch(/^Gmail's connection expired or was revoked\. Call suggest_service with slug "gmail"/)
            expect(upsertRegistryEntry).toHaveBeenCalledTimes(1)
            expect(upsertRegistryEntry).toHaveBeenCalledWith(conn, 'engine-own', 'gmail@k3x9ab', { ...extra, status: 'needs_auth', composio: { toolkit: 'gmail', serverName: 'gmail-k3x9ab' } })
        })

        it('sorts a thrown not-connected 404 the same way, before mapping 404 to an unknown tool', async () => {
            registryWith({ status: 'needs_auth' })
            vi.mocked(executeTool).mockRejectedValue(new ComposioApiError(404, `Composio POST /tools/execute/GMAIL_LIST_THREADS failed (404): ${NO_ACCOUNT}`))

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toMatch(/^Gmail is not connected yet\. Call suggest_service with slug "gmail"/)
        })

        it('sends an active entry back to needs_auth when Google refused the scope the tool needs', async () => {
            const entry = registryWith({ status: 'active', composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_1' } })
            vi.mocked(executeTool).mockResolvedValue({ successful: false, data: null, error: 'Request had insufficient authentication scopes.' })

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toBe('Gmail is connected without the permission this needs. Call suggest_service with slug "gmail" so the user connects it again and grants it, then end your turn.')
            expect(upsertRegistryEntry).toHaveBeenCalledWith(conn, 'engine-own', 'gmail', { ...entry, status: 'needs_auth', composio: { toolkit: 'gmail', serverName: 'gmail' } })
            expect(deleteConnectedAccount).toHaveBeenCalledWith('ca_1')
        })

        it('sorts a thrown scope refusal the same way', async () => {
            registryWith({ status: 'active', composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_1' } })
            vi.mocked(executeTool).mockRejectedValue(new ComposioApiError(403, 'Composio POST /tools/execute/GMAIL_LIST_THREADS failed (403): {"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}'))

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toMatch(/^Gmail is connected without the permission this needs\./)
            expect(upsertRegistryEntry).toHaveBeenCalledOnce()
            expect(deleteConnectedAccount).toHaveBeenCalledWith('ca_1')
        })

        it('still answers the agent when Composio cannot drop the account', async () => {
            registryWith({ status: 'active', composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_1' } })
            vi.mocked(executeTool).mockResolvedValue({ successful: false, data: null, error: 'Request had insufficient authentication scopes.' })
            vi.mocked(deleteConnectedAccount).mockRejectedValue(new Error('Composio down'))

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toMatch(/^Gmail is connected without the permission this needs\./)
            expect(upsertRegistryEntry).toHaveBeenCalledOnce()
        })

        it('falls back to a first connection when the registry cannot be read', async () => {
            vi.mocked(readRegistry).mockRejectedValue(new Error('box unreachable'))

            const text = await errorText(await POST(request(toolCall('GMAIL_LIST_THREADS')), context()))

            expect(text).toMatch(/^Gmail is not connected yet\./)
            expect(upsertRegistryEntry).not.toHaveBeenCalled()
        })
    })
})
