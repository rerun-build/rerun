import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compileService, decompileService } from '@/lib/services/compiler'
import { type RegistryEntry, type ServiceRegistry, readRegistry, removeRegistryEntry, upsertRegistryEntry } from '@/lib/services/registry'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { CLOUD_ENTITLEMENTS } from '@/test/cloud-fakes'
import { dispatchHubTool, getServiceDetails, installService, installedFromRegistry, listInstalledServices, markServiceAuthorized, resetServiceConnection, searchServices, uninstallService } from './services.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: {}, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/compiler', () => ({
    compileService: vi.fn(async () => ({ toolNames: [], oauth: null, managed: null, composio: { toolkit: 'gmail', serverName: 'gmail' }, app: null })),
    decompileService: vi.fn(),
}))
vi.mock('@/lib/services/registry', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/services/registry')>()),
    readRegistry: vi.fn(),
    upsertRegistryEntry: vi.fn(),
    removeRegistryEntry: vi.fn(),
}))
vi.mock('@/lib/services/embed', () => ({ embedText: vi.fn(async () => null), toVectorLiteral: vi.fn() }))
vi.mock('@/lib/services/rerank', () => ({ rerankRelevant: vi.fn() }))
// The open source build resolves `@rerun/cloud` to `cloud-oss`, with no paid apps; the reset logic under test is the same in both.
vi.mock('@rerun/cloud/apps', () => ({ isAppSlug: (value: unknown) => value === 'whatsapp' }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...CLOUD_ENTITLEMENTS }))

const composioMethod = { id: 'composio', label: 'Connect', kind: 'composio', recommended: true, composio: { toolkit: 'gmail', authConfigId: 'ac', allowedTools: [] } }
const appMethod = { id: 'app', label: 'Connect', kind: 'app', recommended: true, app: { appSlug: 'whatsapp' } }
const MANIFESTS: Record<string, unknown> = {
    gmail: { slug: 'gmail', name: 'Gmail', multiInstance: true, authMethods: [composioMethod] },
    'linkedin-pro': { slug: 'linkedin-pro', name: 'LinkedIn Pro', authMethods: [composioMethod] },
    'whatsapp-pro': { slug: 'whatsapp-pro', name: 'WhatsApp Pro', authMethods: [appMethod] },
}

function eqSlug(calls: readonly { method: string; args: unknown[] }[]): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === 'slug')?.args[1]
}

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ status: 'active', config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '2026-10-01', ...over })

// The agent's workspace, read by the paid-apps rule: absent from the fake unless a test sets it.
let workspacePlan: string | null = null

function useRegistry(reg: ServiceRegistry) {
    vi.mocked(readRegistry).mockResolvedValue(reg)
}

beforeEach(() => {
    vi.clearAllMocks()
    workspacePlan = null
    vi.mocked(createServiceRoleClient).mockReturnValue(
        fakeSupabase((table, calls) => {
            if (table === 'agents') return workspacePlan ? { data: { workspace_id: 1 } } : undefined
            if (table === 'workspaces') return { data: { plan: workspacePlan } }
            if (table !== 'services') return undefined
            const slug = eqSlug(calls)
            if (typeof slug === 'string') return { data: MANIFESTS[slug] ? { manifest: MANIFESTS[slug], enabled: true } : null }
            return {
                data: [
                    { slug: 'gmail', name: 'Gmail', icon: null, category: 'productivity', summary: '', manifest: MANIFESTS.gmail, verified: true },
                    { slug: 'notion', name: 'Notion', icon: null, category: 'productivity', summary: '', manifest: { slug: 'notion', name: 'Notion' }, verified: true },
                    { slug: 'whatsapp-pro', name: 'WhatsApp Pro', icon: null, category: 'communication', summary: '', manifest: MANIFESTS['whatsapp-pro'], verified: true },
                ],
            }
        }).client,
    )
})

describe('installService', () => {
    it('allocates a new account when the app takes several', async () => {
        useRegistry({ services: { gmail: entry() } })
        const result = await installService('agent', 'gmail', {}, undefined, undefined, { newInstance: true })

        expect(result.key).toMatch(/^gmail@[a-z0-9]{6}$/)
        const [, , , , , instance] = vi.mocked(compileService).mock.calls[0]
        expect(instance).toMatchObject({ key: result.key, label: 'Gmail 2' })
    })

    it('ignores newInstance on an app limited to one account', async () => {
        useRegistry({ services: {} })
        const result = await installService('agent', 'linkedin-pro', {}, undefined, undefined, { newInstance: true })

        expect(result.key).toBe('linkedin-pro')
        expect(vi.mocked(compileService).mock.calls[0][5]).toBeUndefined()
    })

    it('reinstalls the base account when an instance key names an app limited to one account', async () => {
        useRegistry({ services: {} })
        const result = await installService('agent', 'linkedin-pro@abc123')

        expect(result.key).toBe('linkedin-pro')
        expect(vi.mocked(compileService).mock.calls[0][5]).toBeUndefined()
    })

    it('reinstalls an existing extra account under its key and keeps its label', async () => {
        useRegistry({ services: { gmail: entry(), 'gmail@k3x9ab': entry({ instanceId: 'k3x9ab', label: 'ops@acme.com' }) } })
        const result = await installService('agent', 'gmail@k3x9ab')

        expect(result.key).toBe('gmail@k3x9ab')
        expect(vi.mocked(compileService).mock.calls[0][5]).toEqual({ key: 'gmail@k3x9ab', instanceId: 'k3x9ab', label: 'ops@acme.com' })
    })
})

describe('getServiceDetails', () => {
    it('describes the addressed account and lists every account of the app', async () => {
        useRegistry({ services: { 'gmail@k3x9ab': entry({ status: 'needs_auth', label: 'Gmail 2', installedAt: '2026-10-02' }), gmail: entry() } })
        const details = await getServiceDetails('agent', 'gmail@k3x9ab')

        expect(details).toMatchObject({ key: 'gmail@k3x9ab', slug: 'gmail', label: 'Gmail 2', installStatus: 'needs_auth', multiInstance: true })
        expect(details.instances).toEqual([
            { key: 'gmail', status: 'active' },
            { key: 'gmail@k3x9ab', status: 'needs_auth', label: 'Gmail 2' },
        ])
    })
})

describe('installedFromRegistry', () => {
    it('lists one row per account, the base one first', async () => {
        const rows = await installedFromRegistry({ services: { 'gmail@k3x9ab': entry({ label: 'Gmail 2', installedAt: '2026-10-02' }), notion: entry(), gmail: entry() } })

        expect(rows.map(r => [r.key, r.slug, r.label])).toEqual([
            ['gmail', 'gmail', undefined],
            ['gmail@k3x9ab', 'gmail', 'Gmail 2'],
            ['notion', 'notion', undefined],
        ])
        expect(rows[1].instanceId).toBe('k3x9ab')
    })
})

describe('searchServices', () => {
    it('shows an app installed while only an extra account is left', async () => {
        useRegistry({ services: { 'gmail@k3x9ab': entry() } })
        const { results } = await searchServices('agent')

        expect(results.find(r => r.slug === 'gmail')).toMatchObject({ installStatus: 'active', installed: true, multiInstance: true })
    })

    it('lists the paid apps for a workspace on a plan', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'base'
        const { results } = await searchServices('agent')

        expect(results.map(r => r.slug)).toContain('whatsapp-pro')
    })

    it('leaves the paid apps out for a lifetime workspace, which cannot buy a slot', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime'
        const { results } = await searchServices('agent')

        expect(results.map(r => r.slug)).toEqual(['gmail', 'notion'])
    })
})

describe('installService on a lifetime workspace', () => {
    it('refuses a paid app', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime'

        await expect(installService('agent', 'whatsapp-pro')).rejects.toThrow('WhatsApp Pro is not included in the lifetime plan.')
        expect(compileService).not.toHaveBeenCalled()
    })

    it('still installs any other service', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime'

        await expect(installService('agent', 'gmail')).resolves.toMatchObject({ slug: 'gmail' })
    })
})

describe('uninstallService', () => {
    it('leaves the skills another account still lists and removes only its own entry', async () => {
        useRegistry({ services: { gmail: entry({ skills: ['gmail-usage'] }), 'gmail@k3x9ab': entry({ skills: ['gmail-usage'] }) } })
        await uninstallService('agent', 'gmail@k3x9ab')

        expect(vi.mocked(decompileService).mock.calls[0][3]).toEqual({ keepSkills: new Set(['gmail-usage']) })
        expect(vi.mocked(removeRegistryEntry)).toHaveBeenCalledWith({}, 'engine-agent', 'gmail@k3x9ab')
        expect(upsertRegistryEntry).not.toHaveBeenCalled()
    })
})

describe('resetServiceConnection', () => {
    const app = { appSlug: 'whatsapp', serverName: 'whatsapp_pro' }

    function useBinding(connection: { label: string | null; status: string } | null) {
        vi.mocked(createServiceRoleClient).mockReturnValue(
            fakeSupabase(table => {
                if (table === 'app_connection_agents') return { data: connection ? { connection_id: 'conn' } : null }
                if (table === 'app_connections') return { data: connection }
                return undefined
            }).client,
        )
    }

    it('keeps a paid app active while its coworker is still bound to an account', async () => {
        useRegistry({ services: { 'whatsapp-pro': entry({ status: 'active', app: { ...app, accountLabel: 'Shop' } }) } })
        useBinding({ label: 'Shop', status: 'connected' })

        await expect(resetServiceConnection('agent', 'whatsapp-pro')).resolves.toEqual({ mode: 'auth', app })
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3]).toMatchObject({ status: 'active', app: { ...app, accountLabel: 'Shop' } })
    })

    it('repairs a bound coworker left waiting on a sign-in', async () => {
        useRegistry({ services: { 'whatsapp-pro': entry({ status: 'needs_auth', app }) } })
        useBinding({ label: 'Shop', status: 'connected' })

        await resetServiceConnection('agent', 'whatsapp-pro')
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3]).toMatchObject({ status: 'active', app: { ...app, accountLabel: 'Shop' } })
    })

    it('sends a coworker with no account back to the picker', async () => {
        useRegistry({ services: { 'whatsapp-pro': entry({ status: 'active', app: { ...app, accountLabel: 'Shop' } }) } })
        useBinding(null)

        await expect(resetServiceConnection('agent', 'whatsapp-pro')).resolves.toEqual({ mode: 'auth', app })
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3]).toMatchObject({ status: 'needs_auth', app })
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3].app).not.toHaveProperty('accountLabel')
    })
})

// A member who only uses the Box still sees the coworker's apps, and changes none of them.
describe('access level', () => {
    const MEMBER = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' } as const

    beforeEach(() => {
        vi.mocked(resolveAgentTarget).mockClear()
        useRegistry({ services: { gmail: entry() } })
    })

    it('reads the installed apps at use', async () => {
        await listInstalledServices('agent', MEMBER)
        await searchServices('agent', undefined, undefined, MEMBER)
        await getServiceDetails('agent', 'gmail', MEMBER).catch(() => null)

        for (const call of vi.mocked(resolveAgentTarget).mock.calls) expect(call).toEqual(['agent', MEMBER])
    })

    it('asks manage to install, reset, authorize or uninstall', async () => {
        await uninstallService('agent', 'gmail', MEMBER)
        await resetServiceConnection('agent', 'gmail', MEMBER)
        await markServiceAuthorized('agent', 'gmail', MEMBER)

        expect(vi.mocked(resolveAgentTarget).mock.calls).toEqual([
            ['agent', MEMBER, 'manage'],
            ['agent', MEMBER, 'manage'],
            ['agent', MEMBER, 'manage'],
        ])
    })

    it('runs a hub call from the engine as the workspace itself', async () => {
        await dispatchHubTool('agent', 'service_list_installed', {}, 7)

        expect(resolveAgentTarget).toHaveBeenCalledWith('agent', { kind: 'workspace', workspaceId: 7 })
    })
})
