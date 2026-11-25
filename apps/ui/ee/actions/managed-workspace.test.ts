import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerSession } from '@/supabase/session/getServerSession'
import { fakeSupabase } from '@/test/supabase-fake'

const MANAGED = { id: 7, name: 'Acme', plan: 'organization', subscription_status: 'active', organization_id: 'org-nordlys', is_sandbox: false, stripe_customer_id: 'cus_left_over', price_arm: null }
const OWN = { ...MANAGED, plan: 'base', organization_id: null }

const mocks = vi.hoisted(() => ({ workspace: null as unknown, stripeTouched: vi.fn(), db: null as unknown }))

vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()),
    stripe: new Proxy(
        {},
        {
            get(_, resource) {
                mocks.stripeTouched(String(resource))
                throw new Error(`stripe.${String(resource)}`)
            },
        },
    ),
}))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = async () => ({ user: { id: 'member', workspace_id: 7, locale: null }, workspace: mocks.workspace, workspaceRefused: false, membership: { role: 'admin', box_scope: 'all', organization_staff: false }, session: { id: 'member', email: 'member@acme.test', is_anonymous: false } })
    return { getServerSession: vi.fn(session), getSessionWorkspace: vi.fn(session), getSessionIdentity: vi.fn(async () => (await session()).session), getAuthUser: vi.fn(async () => (await session()).session) }
})
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.db }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: async () => 'https://app.rerun.test' }))
vi.mock('@rerun/cloud/apps.server', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/apps.server')>()), paidAppFlag: async () => true }))

const billing = await import('./billing.actions')
const referral = await import('./referral.actions')
const apps = await import('@/app/api/_actions/apps.actions')
const { startTemplateCheckoutAction } = await import('./template-purchase.actions')
const { createWorkspaceAction } = await import('@/app/api/_actions/workspace.actions')
const { listChangelogAction } = await import('@/app/api/_actions/changelog.actions')
const { startAppTrial } = await import('@/app/api/v1/onboarding/_lib/start-trial')
const { ensureStripeCustomer, startCardlessTrial } = await import('@/ee/services/billing.service')

type Action = (...args: unknown[]) => Promise<unknown>
const actionsOf = (module: object, except: string[] = []) => Object.entries(module).filter(([name, value]) => typeof value === 'function' && name.endsWith('Action') && !except.includes(name)) as [string, Action][]

// Reading where the credit went and pausing it stay the workspace's own.
const BILLING = actionsOf(billing, ['getCreditUsageAction', 'setRerunCreditPausedAction'])
const APPS = actionsOf(apps).map(([name, action]) => [name, (...rest: unknown[]) => (name === 'connectLinkedinAction' || name === 'connectWhatsappAction' ? action(...rest) : action('linkedin', ...rest))] as [string, Action])
const REFUSED = [...BILLING, ...actionsOf(referral), ...APPS, ['startTemplateCheckoutAction', startTemplateCheckoutAction as Action] as [string, Action], ['createWorkspaceAction', createWorkspaceAction as Action] as [string, Action]]

let db: ReturnType<typeof fakeSupabase>

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.workspace = MANAGED
    db = fakeSupabase(table => (table === 'workspaces' ? { data: mocks.workspace } : undefined))
    mocks.db = db.client
})

describe('a workspace an organization runs', () => {
    it('covers every action of the billing dialogs, the referrals and the paid apps', () => {
        expect(BILLING.length).toBeGreaterThan(25)
        expect(APPS.length).toBeGreaterThan(10)
        expect(actionsOf(referral)).toHaveLength(2)
    })

    it.each(REFUSED)('%s is refused, Stripe and the database left alone', async (_name, action) => {
        await expect(action('cs_1', 'x')).resolves.toMatchObject({ ok: false, code: 'managedWorkspace' })
        expect(mocks.stripeTouched).not.toHaveBeenCalled()
        expect(db.writes('workspaces')).toEqual([])
        expect(db.writes('users')).toEqual([])
    })

    it('never gets a Stripe customer nor a trial, whatever asks for one', async () => {
        await expect(ensureStripeCustomer()).rejects.toMatchObject({ code: 'managedWorkspace' })
        mocks.workspace = { ...MANAGED, subscription_status: 'canceled' }
        await expect(startCardlessTrial('ios')).rejects.toMatchObject({ code: 'managedWorkspace' })
        expect(mocks.stripeTouched).not.toHaveBeenCalled()
    })

    it.each([
        ['active', true],
        ['canceled', false],
    ])('answers the app that asks for a trial with where it stands: %s', async (subscription_status, entitled) => {
        const ctx = { workspace: { ...MANAGED, subscription_status } } as never
        expect(await startAppTrial({ req: new Request('https://app.rerun.test', { headers: { 'x-rerun-client': 'ios/200' } }), ctx })).toEqual({ entitled })
        expect(mocks.stripeTouched).not.toHaveBeenCalled()
    })

    it('reads none of Rerun’s announcements', async () => {
        expect(await listChangelogAction()).toEqual({ entries: [], seenAt: null })
        expect(db.chainsOn('changelog_entries')).toEqual([])
    })

    it('keeps its admin in charge of pausing its credit', async () => {
        expect(await billing.setRerunCreditPausedAction(true)).toEqual({ ok: true })
        expect(db.writes('workspaces')).toHaveLength(1)
        expect(db.writes('workspaces')[0].payload).toMatchObject({ rerun_credit_paused_at: expect.any(String) })
    })
})

describe('a workspace of its own', () => {
    it.each(REFUSED)('%s is not refused for being managed', async (_name, action) => {
        mocks.workspace = OWN
        const result = await action('cs_1', 'x').catch(() => ({ code: 'threw' }))
        expect(result).not.toMatchObject({ code: 'managedWorkspace' })
        expect(vi.mocked(getServerSession)).toHaveBeenCalled()
    })
})
