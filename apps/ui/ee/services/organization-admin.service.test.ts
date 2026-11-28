import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, AGENCY_HOME, CLIENT, CLIENT_ADMIN, EMAILS, HAVRE, memberRow, NORDLYS, organizationRow, organizationTables, organizationWorld, OWNER, RIVAL_WORKSPACE, STRANGER, workspaceRow, type OrganizationWorld } from '@/ee/test/organization-world'
import type { SupabaseCall, SupabaseResult } from '@/test/supabase-fake'
import { writeMethodOf } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({
    client: null as unknown,
    delivery: true,
    restore: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    sendWorkspaceInviteEmail: vi.fn(async () => ({ ok: true, id: null })),
    subscriptions: vi.fn(async () => ({ data: [] as { status: string }[] })),
    revokeComputers: vi.fn(async () => {}),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', () => ({ organizationBrandOfWorkspace: async () => null, archiveOrganizationMachine: mocks.archive, restoreOrganizationMachine: mocks.restore, restartOrganizationMachine: vi.fn(), destroyOrganizationMachine: vi.fn(), readOrganizationMachine: vi.fn(), readOrganizationMachines: async () => new Map() }))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@rerun/cloud/email', () => ({ get EMAIL_DELIVERY() { return mocks.delivery }, sendWorkspaceInviteEmail: mocks.sendWorkspaceInviteEmail, BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn() }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('next/server', () => ({ after: (task: () => unknown) => void task() }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: mocks.revokeComputers }))
vi.mock('@/lib/workspace/read-logo', () => ({ readWorkspaceLogo: vi.fn() }))
vi.mock('@/lib/apps/lifecycle', () => ({ syncWorkspaceAppsSafely: vi.fn() }))
vi.mock('@/ee/lib/billing/stripe', () => ({ stripe: { subscriptions: { list: mocks.subscriptions } } }))
vi.mock('@/ee/lib/billing/stop-billing', () => ({ stopBilling: vi.fn() }))
vi.mock('@/trigger/sync-agent-activation', () => ({ requestAgentActivationSync: mocks.sync }))

const { addOrganizationOwner, attachRefusal, attachWorkspace, createOrganization, detachWorkspace, findAttachableWorkspaces, listOrganizations, rerunOrganizationContext, updateOrganization } = await import('./organization-admin.service')
const { adjustOrganizationCredit, allocateOrganizationCredit, purchaseOrganizationCredit } = await import('./organization-credit.service')

const RERUN = { userId: '00000000-0000-4000-8000-0000000a0009', email: 'team@rerun.test' }
const DIRECT = 40
const DIRECT_ADMIN = '00000000-0000-4000-8000-0000000a0007'
const request = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const credits = (n: number) => n * 10_000

let world: OrganizationWorld
let accounts: Partial<User>[]

const direct = (overrides: Record<string, unknown> = {}) =>
    workspaceRow(DIRECT, {
        name: 'Globex',
        organization_id: null,
        plan: 'base',
        subscription_status: 'canceled',
        is_sandbox: false,
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_old',
        stripe_addons_subscription_id: null,
        stripe_price_id: 'price_1',
        current_period_end: '2026-12-01T00:00:00Z',
        addons_current_period_end: null,
        subscription_cancel_at: null,
        payment_failed_at: '2026-11-01T00:00:00Z',
        renewal_reminder_at: null,
        renewal_reminder_user_id: null,
        model_access: 'best',
        custom_integrations: true,
        rerun_budget_micros: credits(1000),
        rerun_used_micros: credits(300),
        rerun_topup_micros: credits(500),
        rerun_credit_paused_at: null,
        ...overrides,
    })

function open({ workspace = direct(), tables = {}, before }: { workspace?: Record<string, unknown>; tables?: Parameters<typeof organizationWorld>[0]; before?: (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined | void } = {}) {
    const base = organizationTables()
    world = organizationWorld(
        {
            workspaces: [...base.workspaces, workspace],
            workspace_members: [...base.workspace_members, memberRow(DIRECT_ADMIN, DIRECT)],
            users: [...base.users.map(row => ({ deleted_at: null, ...row })), { id: DIRECT_ADMIN, workspace_id: DIRECT, locale: null, deleted_at: null }],
            rerun_credit_purchases: [],
            ...tables,
        },
        before,
    )
    mocks.client = world.client
    accounts = Object.entries(EMAILS).map(([id, email]) => ({ id, email, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, identities: [] }))
    Object.assign((world.client as unknown as { auth: { admin: object } }).auth.admin, { listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({ data: { users: accounts.slice((page - 1) * perPage, page * perPage) }, error: null }) })
}

const nordlys = () => rerunOrganizationContext(world.client, RERUN, NORDLYS)
const workspace = (id: number) => world.rows('workspaces').find(row => row.id === id)!
const roleOf = (userId: string, organizationId = NORDLYS) => world.rows('organization_members').find(row => row.user_id === userId && row.organization_id === organizationId)?.role
const currentOf = (userId: string) => world.rows('users').find(row => row.id === userId)?.workspace_id
const snapshot = (id: number) => structuredClone(workspace(id))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.delivery = true
    mocks.subscriptions.mockResolvedValue({ data: [] })
    open()
})

describe('creating an organization', () => {
    const create = (over: Partial<Parameters<typeof createOrganization>[2]> = {}) => createOrganization(world.client, RERUN, { name: ' Fjord ', slug: 'fjord', maxWorkspaces: 5, ownerEmail: 'stranger@else.test', ...over })

    it('makes an existing account its owner at once, and invites nobody', async () => {
        const { organizationId, owner } = await create({ ownerEmail: ' STRANGER@else.test ' })
        expect(owner).toEqual({ joined: true })
        expect(world.rows('organizations').find(row => row.id === organizationId)).toMatchObject({ name: 'Fjord', slug: 'fjord', max_workspaces: 5 })
        expect(roleOf(STRANGER, organizationId)).toBe('owner')
        expect(world.rows('organization_invitations')).toEqual([])
        expect(mocks.sendWorkspaceInviteEmail).not.toHaveBeenCalled()
    })

    it('invites an unknown address as an owner', async () => {
        const { organizationId, owner } = await create({ ownerEmail: 'new@fjord.test' })
        expect(owner).toEqual({ joined: false })
        expect(world.rows('organization_invitations')).toEqual([expect.objectContaining({ organization_id: organizationId, email: 'new@fjord.test', role: 'owner', status: 'pending', invited_by: RERUN.userId })])
        expect(mocks.sendWorkspaceInviteEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: 'new@fjord.test', brand: expect.objectContaining({ name: 'Fjord' }) }))
    })

    it('hands the link back where no email leaves', async () => {
        mocks.delivery = false
        await expect(create({ ownerEmail: 'new@fjord.test' })).resolves.toMatchObject({ owner: { joined: false, inviteUrl: expect.stringContaining('/organization/invite/') } })
    })

    it.each([
        ['an address nobody confirmed', { email_confirmed_at: undefined }],
        ['an anonymous account', { is_anonymous: true }],
    ])('never hands it to %s', async (_case, over) => {
        accounts = [{ id: STRANGER, email: EMAILS[STRANGER], email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, identities: [], ...over }]
        await expect(create()).resolves.toMatchObject({ owner: { joined: false } })
        expect(world.rows('organization_members').some(row => row.user_id === STRANGER)).toBe(false)
    })

    it('invites an account that never reached the app, or that was deleted', async () => {
        world.tables.users = world.rows('users').filter(row => row.id !== STRANGER)
        await expect(create()).resolves.toMatchObject({ owner: { joined: false } })
        open()
        world.rows('users').find(row => row.id === STRANGER)!.deleted_at = '2026-11-01T00:00:00Z'
        await expect(create()).resolves.toMatchObject({ owner: { joined: false } })
    })

    it('finds an account past the first page', async () => {
        accounts = [...Array.from({ length: 1000 }, (_, n) => ({ id: `u${n}`, email: `u${n}@x.test`, identities: [] })), ...accounts]
        await expect(create()).resolves.toMatchObject({ owner: { joined: true } })
    })

    it.each([
        [{ slug: 'app' }, 'slugReserved'],
        [{ slug: 'No Good' }, 'slugInvalid'],
    ])('refuses %o before writing anything', async (over, reason) => {
        await expect(create(over)).rejects.toMatchObject({ reason })
        expect(world.writes('organizations')).toEqual([])
    })

    it('refuses an address that is not one before writing anything', async () => {
        await expect(create({ ownerEmail: 'nope' })).rejects.toMatchObject({ code: 'invalidEmailShort' })
        expect(world.writes('organizations')).toEqual([])
    })

    it('says a slug is taken', async () => {
        open({ before: (table, calls) => (table === 'organizations' && writeMethodOf(calls) === 'insert' ? { data: null, error: { code: '23505' } } : undefined) })
        await expect(create()).rejects.toMatchObject({ reason: 'slugTaken' })
    })

    it('leaves nothing behind when its owner could not be added', async () => {
        open({ before: (table, calls) => (table === 'organization_invitations' && writeMethodOf(calls) === 'insert' ? { data: null, error: { code: 'XX', message: 'boom' } } : undefined) })
        const count = world.rows('organizations').length
        await expect(create({ ownerEmail: 'new@fjord.test' })).rejects.toThrow('boom')
        expect(world.rows('organizations')).toHaveLength(count)
    })
})

describe('the settings of an organization', () => {
    it('changes its name, slug and maximum', async () => {
        await updateOrganization(await nordlys(), { name: ' Nordlys Nord ', slug: 'nordlys-nord', maxWorkspaces: 0 })
        expect(world.rows('organizations')[0]).toMatchObject({ name: 'Nordlys Nord', slug: 'nordlys-nord', max_workspaces: 0 })
    })

    it('refuses a reserved or an invalid slug, and keeps one that became reserved since', async () => {
        await expect(updateOrganization(await nordlys(), { name: 'Nordlys', slug: 'mail', maxWorkspaces: 3 })).rejects.toMatchObject({ reason: 'slugReserved' })
        open({ tables: { organizations: [organizationRow({ slug: 'mail' })] } })
        await updateOrganization(await nordlys(), { name: 'Nordlys', slug: 'mail', maxWorkspaces: 9 })
        expect(world.rows('organizations')[0].max_workspaces).toBe(9)
    })

    it('does not know an organization that does not exist', async () => {
        await expect(rerunOrganizationContext(world.client, RERUN, request(1))).rejects.toMatchObject({ reason: 'organizationNotFound' })
    })
})

describe('the owners', () => {
    it('adds an account, promotes an admin, refuses an owner', async () => {
        await expect(addOrganizationOwner(await nordlys(), EMAILS[STRANGER])).resolves.toEqual({ joined: true })
        await expect(addOrganizationOwner(await nordlys(), EMAILS[ADMIN])).resolves.toEqual({ joined: true })
        expect([roleOf(STRANGER), roleOf(ADMIN)]).toEqual(['owner', 'owner'])
        await expect(addOrganizationOwner(await nordlys(), EMAILS[OWNER])).rejects.toMatchObject({ reason: 'alreadyOwner' })
    })

    it('takes the invitation someone had pending', async () => {
        world.rows('organization_invitations').push({ id: 'i1', organization_id: NORDLYS, email: EMAILS[STRANGER], role: 'admin', token: 't', status: 'pending' })
        await addOrganizationOwner(await nordlys(), EMAILS[STRANGER])
        expect(world.rows('organization_invitations')).toEqual([expect.objectContaining({ id: 'i1', status: 'revoked' })])
    })
})

describe('the list', () => {
    it('counts each organization’s own', async () => {
        await purchaseOrganizationCredit(world.client, { organizationId: HAVRE, credits: 250, actorUserId: null, requestId: request(1) })
        world.rows('organization_invitations').push({ id: 'i1', organization_id: HAVRE, email: 'second@havre.test', role: 'owner', status: 'pending' }, { id: 'i2', organization_id: HAVRE, email: 'old@havre.test', role: 'owner', status: 'revoked' })
        const list = await listOrganizations(world.client)
        expect(list.find(row => row.id === NORDLYS)).toMatchObject({ slug: 'nordlys', workspaceCount: 1, maxWorkspaces: 3, balanceMicros: 0, owners: [{ userId: OWNER, email: EMAILS[OWNER] }], invitedOwners: [] })
        expect(list.find(row => row.id === HAVRE)).toMatchObject({ workspaceCount: 1, balanceMicros: credits(250), invitedOwners: ['second@havre.test'] })
    })
})

describe('what can be attached', () => {
    const base = { organization_id: null, is_sandbox: false, plan: 'base', subscription_status: null, stripe_subscription_id: null, stripe_addons_subscription_id: null }
    it.each([
        [{}, null],
        [{ subscription_status: 'canceled', stripe_subscription_id: 'sub' }, null],
        [{ subscription_status: 'trial_expired', stripe_subscription_id: 'sub' }, null],
        [{ subscription_status: 'active' }, null],
        [{ subscription_status: 'active', stripe_subscription_id: 'sub' }, 'subscription'],
        [{ subscription_status: 'trialing', stripe_subscription_id: 'sub' }, 'subscription'],
        [{ subscription_status: 'past_due', stripe_subscription_id: 'sub' }, 'subscription'],
        [{ stripe_addons_subscription_id: 'sub' }, 'subscription'],
        [{ is_sandbox: true, subscription_status: 'active' }, 'sandbox'],
        [{ plan: 'lifetime', subscription_status: 'active' }, 'lifetime'],
        [{ plan: 'lifetime_restricted', subscription_status: 'active' }, 'lifetime'],
        [{ organization_id: HAVRE }, 'inOrganization'],
    ])('%o: %s', (over, refusal) => {
        expect(attachRefusal({ ...base, ...over })).toBe(refusal)
    })

    it('finds by id, by name, and says why one is refused', async () => {
        await expect(findAttachableWorkspaces(world.client, `#${DIRECT}`)).resolves.toEqual([expect.objectContaining({ id: DIRECT, name: 'Globex', refusal: null })])
        await expect(findAttachableWorkspaces(world.client, 'glob')).resolves.toEqual([expect.objectContaining({ id: DIRECT })])
        await expect(findAttachableWorkspaces(world.client, String(CLIENT))).resolves.toEqual([expect.objectContaining({ id: CLIENT, ownerEmail: EMAILS[CLIENT_ADMIN], refusal: 'inOrganization' })])
        await expect(findAttachableWorkspaces(world.client, 'g')).resolves.toEqual([])
        await expect(findAttachableWorkspaces(world.client, '  ')).resolves.toEqual([])
    })
})

describe('attaching a workspace', () => {
    it('moves it to the plan of the organization, keeps its people, and starts it again', async () => {
        world.rows('workspaces').find(row => row.id === DIRECT)!.boxes_archived_at = '2026-11-10T00:00:00Z'
        await attachWorkspace(await nordlys(), DIRECT)
        expect(workspace(DIRECT)).toMatchObject({
            organization_id: NORDLYS,
            organization_archived_at: null,
            plan: 'organization',
            subscription_status: 'active',
            stripe_customer_id: 'cus_1',
            stripe_subscription_id: null,
            stripe_price_id: null,
            current_period_end: null,
            payment_failed_at: null,
            max_agents: null,
            max_seats: null,
            rerun_budget_micros: 0,
            rerun_used_micros: 0,
            rerun_topup_micros: 0,
        })
        expect(world.rows('workspace_members').filter(row => row.workspace_id === DIRECT)).toEqual([expect.objectContaining({ user_id: DIRECT_ADMIN, role: 'admin', organization_staff: false })])
        expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(DIRECT)
    })

    it('leaves it the credit it bought, and none of the credit it was given', async () => {
        world.tables.rerun_credit_purchases = [{ workspace_id: DIRECT, micros: credits(300), refunded_micros: credits(100) }]
        await attachWorkspace(await nordlys(), DIRECT)
        expect(workspace(DIRECT).rerun_topup_micros).toBe(credits(200))
    })

    it.each([
        ['sandbox', { is_sandbox: true }],
        ['lifetime', { plan: 'lifetime', subscription_status: 'active', stripe_subscription_id: null }],
        ['subscription', { subscription_status: 'trialing' }],
        ['inOrganization', { organization_id: HAVRE }],
    ])('refuses one that is %s', async (reason, over) => {
        open({ workspace: direct(over) })
        const before = snapshot(DIRECT)
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ reason })
        expect(workspace(DIRECT)).toEqual(before)
    })

    it('asks Stripe, and refuses a subscription the workspace lost track of', async () => {
        mocks.subscriptions.mockResolvedValue({ data: [{ status: 'canceled' }, { status: 'past_due' }] })
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ reason: 'subscription' })
        mocks.subscriptions.mockResolvedValue({ data: [{ status: 'canceled' }, { status: 'incomplete_expired' }] })
        await attachWorkspace(await nordlys(), DIRECT)
        expect(workspace(DIRECT).organization_id).toBe(NORDLYS)
    })

    it('writes nothing while Stripe does not answer', async () => {
        mocks.subscriptions.mockRejectedValue(new Error('stripe is down'))
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toThrow('stripe is down')
        expect(workspace(DIRECT).organization_id).toBeNull()
    })

    it('refuses one too many, an unknown one, one whose machine is moving, and a suspended organization', async () => {
        open({ tables: { organizations: [organizationRow({ max_workspaces: 1 })] } })
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ code: 'organizationWorkspaceLimit' })
        open()
        await expect(attachWorkspace(await nordlys(), 999)).rejects.toMatchObject({ reason: 'workspaceNotFound' })
        open({ tables: { workspace_archives: [{ workspace_id: DIRECT, status: 'archiving' }] } })
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ code: 'workspaceMachineBusy' })
        open({ tables: { organizations: [organizationRow({ status: 'suspended' })] } })
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ code: 'organizationSuspended' })
        expect(workspace(DIRECT).organization_id).toBeNull()
    })

    it('puts it back as it was when another tab took the last place', async () => {
        let raced = false
        open({
            tables: { organizations: [organizationRow({ max_workspaces: 2 })] },
            before: (table, calls) => {
                if (raced || table !== 'workspaces' || writeMethodOf(calls) !== 'update') return
                raced = true
                world.rows('workspaces').push(workspaceRow(77))
            },
        })
        const before = snapshot(DIRECT)
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ code: 'organizationWorkspaceLimit' })
        expect(workspace(DIRECT)).toEqual(before)
        expect(mocks.restore).not.toHaveBeenCalled()
    })

    it('puts it back when the organization was suspended meanwhile', async () => {
        open({
            before: (table, calls) => {
                if (table === 'workspaces' && writeMethodOf(calls) === 'update') world.rows('organizations')[0].status = 'suspended'
            },
        })
        const before = snapshot(DIRECT)
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ code: 'organizationSuspended' })
        expect(workspace(DIRECT)).toEqual(before)
    })

    it.each([
        ['a checkout', { subscription_status: 'trialing' }],
        ['a lifetime code', { plan: 'lifetime' }],
        ['another organization', { organization_id: HAVRE }],
    ])('never writes over %s that landed meanwhile', async (_case, change) => {
        let raced = false
        open({
            before: (table, calls) => {
                if (raced || table !== 'workspaces' || writeMethodOf(calls) !== 'update') return
                raced = true
                Object.assign(workspace(DIRECT), change)
            },
        })
        await expect(attachWorkspace(await nordlys(), DIRECT)).rejects.toMatchObject({ reason: 'workspaceChanged' })
        expect(workspace(DIRECT)).toMatchObject(change)
        expect(workspace(DIRECT).plan).not.toBe('organization')
    })

    it('attaches once from two clicks', async () => {
        const ctx = await nordlys()
        const outcomes = await Promise.allSettled([attachWorkspace(ctx, DIRECT), attachWorkspace(ctx, DIRECT)])
        expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
        expect(workspace(DIRECT).organization_id).toBe(NORDLYS)
    })
})

describe('detaching a workspace', () => {
    const staff = () => world.rows('workspace_members').filter(row => row.workspace_id === CLIENT && row.organization_staff)

    it('gives it back to its people with no access and nothing deleted', async () => {
        world.rows('agents').push({ id: 'a1', workspace_id: CLIENT, kind: 'coworker', disabled_at: null, created_at: '2026-11-01' })
        await detachWorkspace(await nordlys(), CLIENT)
        expect(workspace(CLIENT)).toMatchObject({ organization_id: null, organization_archived_at: null, plan: 'base', subscription_status: 'canceled', rerun_budget_micros: 0, name: 'Acme' })
        expect(world.rows('workspace_members').filter(row => row.workspace_id === CLIENT)).toEqual([expect.objectContaining({ user_id: CLIENT_ADMIN })])
        expect(world.rows('agents')[0].disabled_at).not.toBeNull()
        expect(mocks.sync).toHaveBeenCalledWith(['a1'])
        expect(mocks.archive).not.toHaveBeenCalled()
    })

    it('takes its team out, whatever they have open', async () => {
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { organization_staff: true }))
        world.rows('users').find(row => row.id === OWNER)!.workspace_id = CLIENT
        await detachWorkspace(await nordlys(), CLIENT)
        expect(staff()).toEqual([])
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
        expect(currentOf(CLIENT_ADMIN)).toBe(CLIENT)
        expect(mocks.revokeComputers).toHaveBeenCalledExactlyOnceWith(CLIENT, OWNER)
    })

    it('returns to the reserve what the organization handed out, and no more', async () => {
        workspace(CLIENT).rerun_topup_micros = credits(70)
        await purchaseOrganizationCredit(world.client, { organizationId: NORDLYS, credits: 500, actorUserId: null, requestId: request(1) })
        await allocateOrganizationCredit(await nordlys(), { workspaceId: CLIENT, credits: 200, requestId: request(2) })
        await detachWorkspace(await nordlys(), CLIENT)
        expect(workspace(CLIENT).rerun_topup_micros).toBe(credits(70))
        expect(world.rows('organization_credit_movements').at(-1)).toMatchObject({ kind: 'take_back', micros: credits(200), balance_after: credits(500), workspace_id: CLIENT })
    })

    it('returns what is left when part of it was spent', async () => {
        await purchaseOrganizationCredit(world.client, { organizationId: NORDLYS, credits: 500, actorUserId: null, requestId: request(1) })
        await allocateOrganizationCredit(await nordlys(), { workspaceId: CLIENT, credits: 200, requestId: request(2) })
        workspace(CLIENT).rerun_topup_micros = credits(30)
        await detachWorkspace(await nordlys(), CLIENT)
        expect(workspace(CLIENT).rerun_topup_micros).toBe(0)
        expect(world.rows('organization_credit_movements').at(-1)).toMatchObject({ balance_after: credits(330) })
    })

    it('stays in the organization, to be detached again, when something resists', async () => {
        let broken = true
        open({ before: (table, calls) => (broken && table === 'workspace_members' && writeMethodOf(calls) === 'delete' ? { data: null, error: { message: 'boom' } } : undefined) })
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { organization_staff: true }))
        await expect(detachWorkspace(await nordlys(), CLIENT)).rejects.toThrow('boom')
        expect(workspace(CLIENT).organization_id).toBe(NORDLYS)
        broken = false
        await detachWorkspace(await nordlys(), CLIENT)
        expect(workspace(CLIENT).organization_id).toBeNull()
        expect(staff()).toEqual([])
    })

    it('sweeps someone who opened it while it was leaving', async () => {
        let raced = false
        open({
            before: (table, calls) => {
                const payload = calls.find(call => call.method === 'update')?.args[0] as { organization_id?: unknown } | undefined
                if (raced || table !== 'workspaces' || payload?.organization_id !== null) return
                raced = true
                world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { organization_staff: true }))
            },
        })
        await detachWorkspace(await nordlys(), CLIENT)
        expect(staff()).toEqual([])
    })

    it('refuses with only its team inside, a workspace of another organization, and a machine that is moving', async () => {
        world.tables.workspace_members = [memberRow(OWNER, CLIENT, { organization_staff: true })]
        await expect(detachWorkspace(await nordlys(), CLIENT)).rejects.toMatchObject({ reason: 'noClientAdmin' })
        open()
        await expect(detachWorkspace(await nordlys(), RIVAL_WORKSPACE)).rejects.toMatchObject({ code: 'workspaceNotFound' })
        open({ tables: { workspace_archives: [{ workspace_id: CLIENT, status: 'restoring' }] } })
        await expect(detachWorkspace(await nordlys(), CLIENT)).rejects.toMatchObject({ code: 'workspaceMachineBusy' })
        expect(workspace(CLIENT)).toMatchObject({ organization_id: NORDLYS, subscription_status: 'active' })
    })
})

describe('the reserve', () => {
    it('refuses a request id sent again for another amount', async () => {
        const buy = (amount: number) => purchaseOrganizationCredit(world.client, { organizationId: NORDLYS, credits: amount, actorUserId: null, requestId: request(1) })
        await buy(100)
        await expect(buy(100)).resolves.toBe(credits(100))
        await expect(buy(1000)).rejects.toMatchObject({ code: 'invalidRequest' })
        await expect(adjustOrganizationCredit(world.client, { organizationId: NORDLYS, credits: 100, actorUserId: null, requestId: request(1) })).rejects.toMatchObject({ code: 'invalidRequest' })
        expect(world.rows('organization_credit_movements')).toHaveLength(1)
    })
})
