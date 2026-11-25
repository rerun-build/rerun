import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAgent, getConnectionUsage, listConnections } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, tableResolver, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'

import { alertSignedOutAccounts, closeReconnectedAccounts } from './ai-account-alert.service'
import { sendAccountSignedOutEmail } from './email.service'
import { loadPresence } from './presence.service'
import { findWorkspaceEngine } from './workspace-engine.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ getAgent: vi.fn(), getConnectionUsage: vi.fn(), listConnections: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn() }))
vi.mock('./presence.service', () => ({ loadPresence: vi.fn() }))
vi.mock('./email.service', () => ({ sendAccountSignedOutEmail: vi.fn() }))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_BACKGROUND_MS: 0, alertBanner: vi.fn(async () => undefined) }))

const WORKSPACE_ID = 7
const KEY = 'workspace:7:ai-account:conn-claude'

type Incident = { user_id: string; source_key: string; opened_at: string; resolved_at: string | null }
let incidents: Incident[]
let tables: Record<string, object[]>
let db: FakeSupabase

const connection = (id: string, provider: string, credentialRejected: boolean, name = provider) => ({ id, provider, name, credentialRejected })
const connected = (...connections: ReturnType<typeof connection>[]) => vi.mocked(listConnections).mockResolvedValue({ connections } as never)
const member = (user_id: string, role = 'admin') => ({ workspace_id: WORKSPACE_ID, user_id, role })

// The two RPCs as the database runs them, over rows the reads see too.
function database(): FakeSupabase {
    const read = tableResolver(new Proxy({}, { get: (_, table: string) => (table === 'notification_incidents' ? incidents : (tables[table] ?? [])) }))
    const fake = fakeSupabase((table, calls) => {
        const args = calls[0].args[1] as Record<string, string>
        if (table === 'rpc:email_domain_is_blocked') return { data: false }
        if (table === 'rpc:open_notification_incident') {
            const known = incidents.find(incident => incident.user_id === args.p_user_id && incident.source_key === args.p_source_key)
            if (known && !known.resolved_at) return { data: false }
            if (known) Object.assign(known, { resolved_at: null, opened_at: new Date().toISOString() })
            else incidents.push({ user_id: args.p_user_id, source_key: args.p_source_key, opened_at: new Date().toISOString(), resolved_at: null })
            return { data: true }
        }
        if (table === 'rpc:resolve_notification_incidents') {
            for (const incident of incidents) if (incident.source_key === args.p_source_key) incident.resolved_at ??= new Date().toISOString()
            return { data: [] }
        }
        if (table === 'notification_incidents' && writeMethodOf(calls) === 'delete') {
            const eq = (column: string) => calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
            incidents = incidents.filter(incident => !(incident.user_id === eq('user_id') && incident.source_key === eq('source_key')))
        }
        if (table === 'notification_incidents' && writeMethodOf(calls) === 'update') {
            const before = calls.find(call => call.method === 'lt')?.args[1] as string
            for (const incident of incidents) if (!incident.resolved_at && incident.opened_at < before) incident.resolved_at = new Date().toISOString()
        }
        return read(table, calls)
    })
    Object.assign(fake.client, { auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@acme.io` } } }) } } })
    return fake
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('UNSUBSCRIBE_SECRET', 'test-secret')
    incidents = []
    tables = {
        workspaces: [{ id: WORKSPACE_ID, name: 'Acme' }],
        workspace_members: [member('ada'), member('bob'), member('carl', 'member')],
        users: ['ada', 'bob', 'carl'].map(id => ({ id, email_notification_prefs: { version: 2, email: false }, locale: null })),
        agents: [
            { id: 'a1', name: 'Lead Scout', engine_agent_id: 'e1', workspace_id: WORKSPACE_ID, kind: 'coworker', disabled_at: null, created_at: '1' },
            { id: 'a2', name: 'Blog Writer', engine_agent_id: 'e2', workspace_id: WORKSPACE_ID, kind: 'coworker', disabled_at: null, created_at: '2' },
            { id: 'a3', name: 'Inbox Triage', engine_agent_id: 'e3', workspace_id: WORKSPACE_ID, kind: 'coworker', disabled_at: null, created_at: '3' },
        ],
    }
    db = database()
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn: { baseUrl: 'http://box', apiKey: null }, managed: true })
    vi.mocked(loadPresence).mockResolvedValue([])
    vi.mocked(getAgent).mockImplementation(async (_conn, id) => ({ resolvedConnectionId: id === 'e2' ? 'conn-openai' : 'conn-claude' }) as never)
    vi.mocked(getConnectionUsage).mockResolvedValue({ agents: [], automations: [], isBoxDefault: true })
    vi.mocked(sendAccountSignedOutEmail).mockResolvedValue({ ok: true, id: 'email-1' })
    connected(connection('conn-claude', 'claude', true), connection('conn-openai', 'openai', false))
})

const sentTo = () => vi.mocked(sendAccountSignedOutEmail).mock.calls.map(([input]) => input.to)

describe('alertSignedOutAccounts', () => {
    it('tells every admin once which account stopped which coworkers, whatever the Email switch says', async () => {
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sentTo()).toEqual(['ada@acme.io', 'bob@acme.io'])
        expect(sendAccountSignedOutEmail).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'subscription', account: 'Claude', coworkers: ['Lead Scout', 'Inbox Triage'], workspaceName: 'Acme', reconnectUrl: expect.stringMatching(/\/\?workspace=7&reconnect=conn-claude$/), unsubscribeUrl: expect.stringMatching(/&category=billing$/) }),
        )
    })

    it('sends one email for ten runs the same account turned away, even at once', async () => {
        tables.workspace_members = [member('ada')]
        await Promise.all(Array.from({ length: 10 }, () => alertSignedOutAccounts(WORKSPACE_ID, 'claude')))
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sentTo()).toEqual(['ada@acme.io'])
    })

    it('counts a coworker one of whose scheduled tasks runs on the account', async () => {
        vi.mocked(getConnectionUsage).mockResolvedValue({ agents: [], automations: [{ agentId: 'e2', kind: 'schedule', slug: 'weekly' }], isBoxDefault: false } as never)
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sendAccountSignedOutEmail).toHaveBeenCalledWith(expect.objectContaining({ coworkers: ['Lead Scout', 'Blog Writer', 'Inbox Triage'] }))
    })

    it('says a refused key is refused, under the name of the connection', async () => {
        connected(connection('conn-openai', 'openai', true, 'OpenAI'))
        await alertSignedOutAccounts(WORKSPACE_ID, 'openai')

        expect(sendAccountSignedOutEmail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'key', account: 'OpenAI', coworkers: ['Blog Writer'] }))
    })

    it('sends one email per account when two are refused', async () => {
        tables.workspace_members = [member('ada')]
        connected(connection('conn-claude', 'claude', true), connection('conn-openai', 'openai', true, 'OpenAI'))
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        await alertSignedOutAccounts(WORKSPACE_ID, 'openai')

        expect(vi.mocked(sendAccountSignedOutEmail).mock.calls.map(([input]) => input.account)).toEqual(['Claude', 'OpenAI'])
    })

    it('leaves alone an admin who has the app open, and writes to them once they left', async () => {
        tables.workspace_members = [member('ada')]
        vi.mocked(loadPresence).mockResolvedValueOnce([{ user_id: 'ada', last_seen_at: new Date().toISOString() }])
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        expect(sentTo()).toEqual([])

        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        expect(sentTo()).toEqual(['ada@acme.io'])
    })

    it('skips an admin who unsubscribed from billing emails', async () => {
        tables.users = [{ id: 'ada', email_notification_prefs: { version: 2, categories: { billing: false } } }, { id: 'bob', email_notification_prefs: null }]
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sentTo()).toEqual(['bob@acme.io'])
    })

    it('tries again when the email did not leave', async () => {
        tables.workspace_members = [member('ada')]
        vi.mocked(sendAccountSignedOutEmail).mockResolvedValueOnce({ ok: false, error: 'boom' })
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        expect(incidents).toEqual([])

        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        expect(sentTo()).toEqual(['ada@acme.io', 'ada@acme.io'])
    })

    it('says nothing when no account is refused, when the machine does not answer, or without one', async () => {
        connected(connection('conn-claude', 'claude', false), connection('rerun', 'rerun', true))
        await alertSignedOutAccounts(WORKSPACE_ID, null)
        vi.mocked(listConnections).mockRejectedValue(new Error('down'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sendAccountSignedOutEmail).not.toHaveBeenCalled()
    })

    it('still alerts, naming nobody, when the coworkers cannot be read', async () => {
        vi.mocked(getAgent).mockRejectedValue(new Error('down'))
        vi.mocked(getConnectionUsage).mockRejectedValue(new Error('down'))
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sendAccountSignedOutEmail).toHaveBeenCalledWith(expect.objectContaining({ coworkers: [] }))
    })
})

describe('closeReconnectedAccounts', () => {
    it('lets the next stop of a reconnected account be heard of', async () => {
        tables.workspace_members = [member('ada')]
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        connected(connection('conn-claude', 'claude', false))
        await closeReconnectedAccounts(WORKSPACE_ID)
        connected(connection('conn-claude', 'claude', true))
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sentTo()).toEqual(['ada@acme.io', 'ada@acme.io'])
    })

    it('keeps the alert of an account still refused, when another one was connected', async () => {
        tables.workspace_members = [member('ada')]
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        await closeReconnectedAccounts(WORKSPACE_ID)
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(incidents).toEqual([expect.objectContaining({ source_key: KEY, resolved_at: null })])
        expect(sentTo()).toEqual(['ada@acme.io'])
    })

    it('closes the alert of an account a run went through on, without it being connected again', async () => {
        tables.workspace_members = [member('ada')]
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        connected(connection('conn-claude', 'claude', false))
        await closeReconnectedAccounts(WORKSPACE_ID, 'claude')
        connected(connection('conn-claude', 'claude', true))
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sentTo()).toEqual(['ada@acme.io', 'ada@acme.io'])
    })

    it('keeps the alert of an account when the run went through on another, even once a restart forgot it was refused', async () => {
        tables.workspace_members = [member('ada')]
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        connected(connection('conn-claude', 'claude', false), connection('conn-openai', 'openai', false))
        await closeReconnectedAccounts(WORKSPACE_ID, 'openai')

        expect(incidents).toEqual([expect.objectContaining({ source_key: KEY, resolved_at: null })])
    })

    it('keeps the alert of a refused account when the run went through on another of its provider', async () => {
        tables.workspace_members = [member('ada')]
        connected(connection('conn-claude', 'claude', true), connection('conn-claude-2', 'claude', false))
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')
        await closeReconnectedAccounts(WORKSPACE_ID, 'claude')

        expect(incidents).toEqual([expect.objectContaining({ source_key: KEY, resolved_at: null })])
    })

    it('reopens an alert left open for over a month', async () => {
        tables.workspace_members = [member('ada')]
        incidents = [{ user_id: 'ada', source_key: KEY, opened_at: '2020-01-01T00:00:00Z', resolved_at: null }]
        await alertSignedOutAccounts(WORKSPACE_ID, 'claude')

        expect(sentTo()).toEqual(['ada@acme.io'])
    })

    it('asks the machine nothing when no alert is open', async () => {
        await closeReconnectedAccounts(WORKSPACE_ID)
        expect(listConnections).not.toHaveBeenCalled()
    })
})
