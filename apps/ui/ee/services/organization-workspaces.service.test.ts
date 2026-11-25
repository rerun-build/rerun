import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENCY_HOME, CLIENT, CLIENT_ADMIN, memberRow, NORDLYS, organizationContext, organizationTables, organizationWorld, OWNER, RIVAL_WORKSPACE, workspaceRow, type OrganizationWorld } from '@/ee/test/organization-world'
import { type SupabaseCall, type SupabaseResult, writeMethodOf } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({
    client: null as unknown,
    archive: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    read: vi.fn(async () => null as unknown),
    readLogo: vi.fn(async () => ({ ok: true }) as unknown),
    sendWorkspaceInviteEmail: vi.fn(async () => ({ ok: true, id: null })),
    stopBilling: vi.fn(async () => null as string | null),
    uninstallApps: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', () => ({
    organizationBrandOfWorkspace: async () => null,
    archiveOrganizationMachine: mocks.archive,
    restoreOrganizationMachine: mocks.restore,
    restartOrganizationMachine: mocks.restart,
    destroyOrganizationMachine: mocks.destroy,
    readOrganizationMachine: mocks.read,
}))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@rerun/cloud/email', () => ({ EMAIL_DELIVERY: true, sendWorkspaceInviteEmail: mocks.sendWorkspaceInviteEmail, BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn(async () => 'https://app.test/og') }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('next/server', () => ({ after: (task: () => unknown) => void task() }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn(async () => {}) }))
vi.mock('@/lib/workspace/read-logo', () => ({ readWorkspaceLogo: mocks.readLogo }))
vi.mock('@/lib/apps/lifecycle', () => ({ syncWorkspaceAppsSafely: mocks.uninstallApps }))
vi.mock('@/ee/lib/billing/stop-billing', () => ({ stopBilling: mocks.stopBilling }))
vi.mock('@/trigger/sync-agent-activation', () => ({ requestAgentActivationSync: mocks.sync }))

const {
    archiveOrganizationWorkspace,
    createOrganizationWorkspace,
    deleteOrganizationWorkspace,
    listOrganizationWorkspaces,
    loadOrganizationWorkspace,
    restartOrganizationWorkspace,
    restoreOrganizationWorkspace,
    resumeOrganization,
    suspendOrganization,
} = await import('./organization-workspaces.service')

let world: OrganizationWorld

function open(overrides: Parameters<typeof organizationWorld>[0] = {}, before?: (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined | void) {
    world = organizationWorld(overrides, before)
    mocks.client = world.client
}

const ctx = () => organizationContext(world)
const workspace = (id: number) => world.rows('workspaces').find(row => row.id === id)
const currentOf = (userId: string) => world.rows('users').find(row => row.id === userId)?.workspace_id

function form(fields: Record<string, string> = {}): FormData {
    const data = new FormData()
    for (const [key, value] of Object.entries({ name: 'Globex', adminEmail: 'hank@globex.test', ...fields })) data.append(key, value)
    return data
}

// The deletion of a workspace takes the accounts that point at it, like `users_workspace_id_fkey`.
function cascade(table: string, calls: readonly SupabaseCall[]) {
    if (table !== 'workspaces' || writeMethodOf(calls) !== 'delete') return
    const id = calls.find(call => call.method === 'eq' && call.args[0] === 'id')?.args[1]
    world.tables.users = world.rows('users').filter(row => row.workspace_id !== id)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.readLogo.mockResolvedValue({ ok: true })
    mocks.stopBilling.mockResolvedValue(null)
    mocks.read.mockResolvedValue(null)
    open()
})

describe('creating a workspace', () => {
    it('is on the organization’s plan, active, with no credit of its own', async () => {
        const { workspaceId } = await createOrganizationWorkspace(ctx(), form({ locale: 'fr' }))
        expect(workspace(workspaceId)).toMatchObject({ name: 'Globex', plan: 'organization', subscription_status: 'active', organization_id: NORDLYS, rerun_budget_micros: 0, rerun_topup_micros: 0, stripe_customer_id: null, max_agents: null, max_seats: null, locale: 'fr' })
        expect(world.rows('agents')).toEqual([expect.objectContaining({ workspace_id: workspaceId, kind: 'foreman' })])
    })

    it('invites its first admin, with nobody of the agency named, and puts nobody in it', async () => {
        const { workspaceId } = await createOrganizationWorkspace(ctx(), form())
        expect(world.rows('workspace_invitations')).toEqual([expect.objectContaining({ workspace_id: workspaceId, email: 'hank@globex.test', role: 'admin', status: 'pending' })])
        await vi.waitFor(() => expect(mocks.sendWorkspaceInviteEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: 'hank@globex.test', workspaceName: 'Globex', invitedByEmail: undefined })))
        expect(world.rows('workspace_members').some(row => row.workspace_id === workspaceId)).toBe(false)
    })

    it.each([
        [{ name: '   ' }, 'nameRequired'],
        [{ name: 'x'.repeat(61) }, 'nameTooLong'],
        [{ adminEmail: 'nope' }, 'invalidEmailShort'],
        [{ adminEmail: '' }, 'invalidEmailShort'],
        [{ locale: 'xx' }, 'unknownLanguage'],
    ])('refuses %o before writing anything', async (fields, code) => {
        await expect(createOrganizationWorkspace(ctx(), form(fields))).rejects.toMatchObject({ code })
        expect(world.writes('workspaces')).toEqual([])
    })

    it('keeps the logo of the form', async () => {
        mocks.readLogo.mockResolvedValue({ ok: true, iconUrl: 'https://cdn.test/globex.webp' })
        const { workspaceId } = await createOrganizationWorkspace(ctx(), form())
        expect(workspace(workspaceId)!.icon_url).toBe('https://cdn.test/globex.webp')
    })

    it('leaves nothing behind when the logo is refused or the invitation could not be written', async () => {
        const count = world.rows('workspaces').length
        mocks.readLogo.mockResolvedValue({ ok: false, error: 'x', code: 'imageUnreadable' })
        await expect(createOrganizationWorkspace(ctx(), form())).rejects.toMatchObject({ code: 'imageUnreadable' })
        mocks.readLogo.mockResolvedValue({ ok: true })
        open({}, (table, calls) => (table === 'workspace_invitations' && writeMethodOf(calls) === 'insert' ? { error: { message: 'down' } } : undefined))
        await expect(createOrganizationWorkspace(ctx(), form())).rejects.toThrow('down')
        expect(world.rows('workspaces')).toHaveLength(count)
    })

    it('refuses past the limit, archived workspaces included', async () => {
        world.rows('organizations')[0].max_workspaces = 1
        workspace(CLIENT)!.organization_archived_at = '2026-11-20T00:00:00Z'
        await expect(createOrganizationWorkspace(ctx(), form())).rejects.toMatchObject({ code: 'organizationWorkspaceLimit', params: { max: 1 } })
        expect(world.writes('workspaces')).toEqual([])
    })

    it('never goes past the limit from two tabs', async () => {
        world.rows('organizations')[0].max_workspaces = 2
        const results = await Promise.allSettled([createOrganizationWorkspace(ctx(), form()), createOrganizationWorkspace(ctx(), form({ adminEmail: 'two@globex.test' })), createOrganizationWorkspace(ctx(), form({ adminEmail: 'three@globex.test' }))])
        expect(world.rows('workspaces').filter(row => row.organization_id === NORDLYS).length).toBeLessThanOrEqual(2)
        for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'organizationWorkspaceLimit' })
    })

    it('gives its place back when the organization is suspended meanwhile', async () => {
        open({}, (table, calls) => {
            if (table === 'workspaces' && writeMethodOf(calls) === 'insert') world.rows('organizations')[0].status = 'suspended'
        })
        await expect(createOrganizationWorkspace(ctx(), form())).rejects.toMatchObject({ code: 'organizationSuspended' })
        expect(world.rows('workspaces').filter(row => row.organization_id === NORDLYS).map(row => row.id)).toEqual([CLIENT])
    })
})

describe('the list', () => {
    it('counts the client’s people and coworkers, without staff, without the Chief of Staff', async () => {
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { organization_staff: true }), memberRow('someone', CLIENT, { role: 'member' }))
        world.rows('agents').push({ id: 'a1', workspace_id: CLIENT, kind: 'coworker' }, { id: 'a2', workspace_id: CLIENT, kind: 'foreman' }, { id: 'a3', workspace_id: RIVAL_WORKSPACE, kind: 'coworker' })
        world.rows('engine_pool').push({ id: 'e1', claimed_by_workspace_id: CLIENT, status: 'claimed' })
        Object.assign(workspace(CLIENT)!, { rerun_topup_micros: 3_000_000, rerun_used_micros: 1_000_000, rerun_period_anchor: new Date().toISOString(), last_active_at: '2026-11-23T10:00:00Z' })

        expect(await listOrganizationWorkspaces(ctx())).toEqual([
            { id: CLIENT, name: 'Acme', iconUrl: null, status: 'active', createdAt: expect.any(String), lastActiveAt: '2026-11-23T10:00:00Z', memberCount: 2, coworkerCount: 1, usedMicros: 1_000_000, leftMicros: 3_000_000, machine: 'running' },
        ])
    })

    it('does not carry the spending of an older month', async () => {
        Object.assign(workspace(CLIENT)!, { rerun_used_micros: 9, rerun_period_anchor: '2026-01-01T00:00:00Z' })
        const [row] = await listOrganizationWorkspaces(ctx())
        expect(row.usedMicros).toBe(0)
    })

    it('reads a thousand workspaces in a bounded number of queries', async () => {
        const many = Array.from({ length: 1000 }, (_, index) => workspaceRow(2000 + index))
        open({ workspaces: many })
        const rows = await listOrganizationWorkspaces(ctx())
        expect(rows).toHaveLength(1000)
        expect(world.chains.length).toBeLessThanOrEqual(1 + 5 * 4)
    })

    it('follows the latest archive', async () => {
        workspace(CLIENT)!.boxes_archived_at = '2026-11-20T00:00:00Z'
        world.rows('workspace_archives').push({ workspace_id: CLIENT, status: 'restoring', created_at: '2026-11-21T00:00:00Z' }, { workspace_id: CLIENT, status: 'archived', created_at: '2026-11-01T00:00:00Z' })
        expect((await listOrganizationWorkspaces(ctx()))[0].machine).toBe('restoring')
    })

    it('adds the machine to the detail of one', async () => {
        mocks.read.mockResolvedValue({ managed: true, running: true, disk: { usedMb: 4000, totalMb: 20000 } })
        expect(await loadOrganizationWorkspace(ctx(), CLIENT)).toMatchObject({ id: CLIENT, hardware: { disk: { usedMb: 4000 } } })
        await expect(loadOrganizationWorkspace(ctx(), RIVAL_WORKSPACE)).rejects.toMatchObject({ code: 'workspaceNotFound' })
    })
})

describe('archiving and restoring', () => {
    beforeEach(() => {
        world.rows('agents').push({ id: 'a1', workspace_id: CLIENT, kind: 'coworker', disabled_at: null, disabled_reason: null, created_at: '1' })
    })

    it('cuts access, switches the coworkers off and asks for the archive', async () => {
        await archiveOrganizationWorkspace(ctx(), CLIENT)
        expect(workspace(CLIENT)).toMatchObject({ subscription_status: 'canceled', organization_archived_at: expect.any(String) })
        expect(mocks.sync).toHaveBeenCalledWith(['a1'])
        expect(mocks.archive).toHaveBeenCalledExactlyOnceWith(CLIENT)
    })

    it('gives access back and asks for the restore, the coworkers waiting for their machine', async () => {
        await archiveOrganizationWorkspace(ctx(), CLIENT)
        workspace(CLIENT)!.boxes_archived_at = '2026-11-20T00:00:00Z'
        await restoreOrganizationWorkspace(ctx(), CLIENT)
        expect(workspace(CLIENT)).toMatchObject({ subscription_status: 'active', organization_archived_at: null })
        expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(CLIENT)
        expect(world.rows('agents')[0].disabled_at).not.toBeNull()
    })

    it('wakes the coworkers at once when the machine had not been archived yet', async () => {
        await archiveOrganizationWorkspace(ctx(), CLIENT)
        await restoreOrganizationWorkspace(ctx(), CLIENT)
        expect(world.rows('agents')[0]).toMatchObject({ disabled_at: null, disabled_reason: null })
        expect(mocks.sync).toHaveBeenLastCalledWith(['a1'], { switchOn: true })
    })

    it('stays cut off when the organization is suspended meanwhile', async () => {
        open({}, (table, calls) => {
            if (table === 'workspaces' && writeMethodOf(calls) === 'update') world.rows('organizations')[0].status = 'suspended'
        })
        await expect(restoreOrganizationWorkspace(ctx(), CLIENT)).rejects.toMatchObject({ code: 'organizationSuspended' })
        expect(workspace(CLIENT)!.subscription_status).toBe('canceled')
        expect(mocks.restore).not.toHaveBeenCalled()
    })
})

describe('restarting', () => {
    it('restarts the machine of an active workspace', async () => {
        await restartOrganizationWorkspace(ctx(), CLIENT)
        expect(mocks.restart).toHaveBeenCalledExactlyOnceWith(CLIENT)
    })

    it('refuses an archived one, and one whose machine is being moved', async () => {
        world.rows('workspace_archives').push({ workspace_id: CLIENT, status: 'restoring' })
        await expect(restartOrganizationWorkspace(ctx(), CLIENT)).rejects.toMatchObject({ code: 'workspaceMachineBusy' })
        workspace(CLIENT)!.organization_archived_at = '2026-11-20T00:00:00Z'
        await expect(restartOrganizationWorkspace(ctx(), CLIENT)).rejects.toMatchObject({ code: 'workspaceArchived' })
        expect(mocks.restart).not.toHaveBeenCalled()
    })
})

describe('deleting', () => {
    it('never takes an account with it: each goes to another workspace of theirs, or to a new one', async () => {
        open({ workspace_members: [...organizationTables().workspace_members, memberRow(OWNER, CLIENT, { organization_staff: true }), memberRow('two-homes', CLIENT), memberRow('two-homes', 44)], users: [...organizationTables().users, { id: 'two-homes', workspace_id: CLIENT, locale: null }] }, cascade)
        world.rows('users').find(row => row.id === OWNER)!.workspace_id = CLIENT

        await deleteOrganizationWorkspace(ctx(), CLIENT)

        expect(workspace(CLIENT)).toBeUndefined()
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
        expect(currentOf('two-homes')).toBe(44)
        const home = currentOf(CLIENT_ADMIN) as number
        expect(workspace(home)).toMatchObject({ name: 'My workspace', organization_id: null, locale: 'fr' })
        expect(world.rows('workspace_members').find(row => row.user_id === CLIENT_ADMIN)).toMatchObject({ workspace_id: home, role: 'admin' })
        expect(world.rows('workspace_members').some(row => row.workspace_id === CLIENT)).toBe(false)
    })

    it('moves someone to a workspace of theirs rather than to another client of the agency', async () => {
        open({ workspaces: [...organizationTables().workspaces, workspaceRow(21)], workspace_members: [memberRow(OWNER, 21, { organization_staff: true }), memberRow(OWNER, CLIENT, { organization_staff: true }), memberRow(OWNER, AGENCY_HOME)] }, cascade)
        world.rows('users').find(row => row.id === OWNER)!.workspace_id = CLIENT
        await deleteOrganizationWorkspace(ctx(), CLIENT)
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
    })

    it('moves out someone whose invitation was being accepted as the doors closed', async () => {
        open({}, (table, calls) => {
            if (table === 'agents' && writeMethodOf(calls) === 'delete') world.rows('users').push({ id: 'late', workspace_id: CLIENT, locale: null })
            return cascade(table, calls) as undefined
        })
        await deleteOrganizationWorkspace(ctx(), CLIENT)
        expect(currentOf('late')).toEqual(expect.any(Number))
        expect(currentOf('late')).not.toBe(CLIENT)
    })

    it('stops what costs first, then the rows, in that order', async () => {
        const order: string[] = []
        mocks.stopBilling.mockImplementation(async () => (order.push('billing'), null))
        mocks.uninstallApps.mockImplementation(async () => void order.push('apps'))
        mocks.destroy.mockImplementation(async () => void order.push('machine'))
        open({}, (table, calls) => {
            if (writeMethodOf(calls) === 'delete') order.push(table)
            return cascade(table, calls) as undefined
        })
        await deleteOrganizationWorkspace(ctx(), CLIENT)
        expect(order).toEqual(['billing', 'apps', 'machine', 'workspace_invitations', 'workspace_members', 'agents', 'spaces', 'workspaces'])
    })

    // 5 credits handed out, 0.8 spent since.
    const handed = { organization_id: NORDLYS, workspace_id: CLIENT, workspace_name: 'Acme', applied_at: '2026-11-01T00:00:00Z', reversal_of: null }
    const handOut = () =>
        world.rows('organization_credit_movements').push(
            { ...handed, id: 'bought', seq: 1, kind: 'purchase', micros: 5_000_000, balance_after: 5_000_000, workspace_id: null, workspace_name: null, request_id: 'bought' },
            { ...handed, id: 'handed', seq: 2, kind: 'allocation', micros: -5_000_000, balance_after: 0, request_id: 'handed' },
        )

    it('returns the credit its client did not spend', async () => {
        handOut()
        workspace(CLIENT)!.rerun_topup_micros = 4_200_000
        await deleteOrganizationWorkspace(ctx(), CLIENT)
        expect(world.rows('organization_credit_movements').at(-1)).toMatchObject({ kind: 'take_back', micros: 4_200_000, balance_after: 4_200_000, workspace_name: 'Acme' })
    })

    it('never takes the credit a workspace bought itself before it joined', async () => {
        workspace(CLIENT)!.rerun_topup_micros = 4_200_000
        await deleteOrganizationWorkspace(ctx(), CLIENT)
        expect(world.rows('organization_credit_movements')).toEqual([])
    })

    it('stops at a machine that resists: access cut, people and rows still there, to be deleted again', async () => {
        mocks.destroy.mockRejectedValueOnce(new Error('host down'))
        await expect(deleteOrganizationWorkspace(ctx(), CLIENT)).rejects.toThrow('host down')
        expect(workspace(CLIENT)).toMatchObject({ subscription_status: 'canceled', organization_archived_at: expect.any(String) })
        expect(currentOf(CLIENT_ADMIN)).toBe(CLIENT)
        expect(world.rows('workspace_members').some(row => row.workspace_id === CLIENT)).toBe(true)

        await deleteOrganizationWorkspace(ctx(), CLIENT)
        expect(workspace(CLIENT)).toBeUndefined()
    })

    it('refuses while the machine is being archived or restored, and another organization’s workspace', async () => {
        world.rows('workspace_archives').push({ workspace_id: CLIENT, status: 'archiving' })
        await expect(deleteOrganizationWorkspace(ctx(), CLIENT)).rejects.toMatchObject({ code: 'workspaceMachineBusy' })
        await expect(deleteOrganizationWorkspace(ctx(), RIVAL_WORKSPACE)).rejects.toMatchObject({ code: 'workspaceNotFound' })
        expect(mocks.destroy).not.toHaveBeenCalled()
        expect(world.writes('workspaces')).toEqual([])
    })

    it('stops before the machine when Stripe could not be stopped', async () => {
        mocks.stopBilling.mockResolvedValue('Stripe is down')
        await expect(deleteOrganizationWorkspace(ctx(), CLIENT)).rejects.toThrow('Stripe is down')
        expect(mocks.destroy).not.toHaveBeenCalled()
    })
})

describe('suspending an organization', () => {
    it('cuts every workspace off, and resuming gives back those its team had not put away', async () => {
        open({ workspaces: [...organizationTables().workspaces, workspaceRow(21, { subscription_status: 'canceled', organization_archived_at: '2026-11-01T00:00:00Z' })] })
        await suspendOrganization(world.client, NORDLYS)
        expect(world.rows('organizations')[0].status).toBe('suspended')
        expect(workspace(CLIENT)).toMatchObject({ subscription_status: 'canceled', organization_archived_at: null })
        expect(workspace(RIVAL_WORKSPACE)!.subscription_status).toBe('active')
        expect(mocks.archive.mock.calls).toEqual([[CLIENT]])

        await resumeOrganization(world.client, NORDLYS)
        expect(workspace(CLIENT)!.subscription_status).toBe('active')
        expect(workspace(21)!.subscription_status).toBe('canceled')
        expect(mocks.restore.mock.calls).toEqual([[CLIENT]])
    })

    it('is the same twice', async () => {
        await suspendOrganization(world.client, NORDLYS)
        await suspendOrganization(world.client, NORDLYS)
        expect(mocks.archive).toHaveBeenCalledTimes(1)
    })
})
