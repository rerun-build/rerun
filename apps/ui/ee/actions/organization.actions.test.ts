import { RERUN_BRAND } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, CLIENT, EMAILS, HAVRE, NORDLYS, organizationWorld, OWNER, RIVAL, RIVAL_CLIENT, RIVAL_WORKSPACE, STRANGER, type OrganizationWorld } from '@/ee/test/organization-world'
import { writeMethodOf } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ client: null as unknown, enabled: true, getSessionIdentity: vi.fn(), getAuthUser: vi.fn(), machine: vi.fn(async () => {}) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: mocks.getSessionIdentity, getAuthUser: mocks.getAuthUser, getServerSession: vi.fn(), getSessionWorkspace: vi.fn() }))
vi.mock('@/lib/brand/server', () => ({ getBrand: async () => RERUN_BRAND }))
vi.mock('@rerun/cloud/organizations', () => ({ get ORGANIZATIONS_ENABLED() { return mocks.enabled } }))
vi.mock('@rerun/cloud/organizations.server', () => ({
    organizationBrandOfWorkspace: async () => null,
    archiveOrganizationMachine: mocks.machine,
    restoreOrganizationMachine: mocks.machine,
    restartOrganizationMachine: mocks.machine,
    destroyOrganizationMachine: mocks.machine,
    readOrganizationMachine: async () => null,
}))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@rerun/cloud/email', () => ({ EMAIL_DELIVERY: false, sendWorkspaceInviteEmail: vi.fn(async () => ({ ok: true, id: null })), BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn(async () => 'https://app.test/og') }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn(async () => {}) }))
vi.mock('@/lib/workspace/read-logo', () => ({ readWorkspaceLogo: async () => ({ ok: true }) }))
vi.mock('@/lib/apps/lifecycle', () => ({ syncWorkspaceAppsSafely: vi.fn(async () => {}) }))
vi.mock('@/ee/lib/billing/stop-billing', () => ({ stopBilling: async () => null }))
vi.mock('@/trigger/sync-agent-activation', () => ({ requestAgentActivationSync: vi.fn(async () => {}) }))

const actions = await import('./organization.actions')

type ActionName = keyof typeof actions
type Call = (workspaceId: number, person: string, invitation: string) => unknown[]

const REQUEST = '00000000-0000-4000-8000-0000000f0001'
const WORKSPACE_INVITE = '00000000-0000-4000-8000-0000000c0001'
const TEAM_INVITE = '00000000-0000-4000-8000-0000000c0002'

function form(): FormData {
    const data = new FormData()
    data.append('name', 'Renamed')
    data.append('adminEmail', 'hank@globex.test')
    return data
}

// Every action of the console, what it takes and what it asks of the caller. An action missing here
// fails the first test: it must say where it stands before it ships.
const CONSOLE: Record<string, { args: Call; reads?: true; min: 'admin' | 'owner'; workspace: boolean }> = {
    listOrganizationWorkspacesAction: { args: () => [], reads: true, min: 'admin', workspace: false },
    loadOrganizationWorkspaceAction: { args: id => [id], reads: true, min: 'admin', workspace: true },
    createOrganizationWorkspaceAction: { args: () => [form()], min: 'admin', workspace: false },
    archiveOrganizationWorkspaceAction: { args: id => [id], min: 'admin', workspace: true },
    restoreOrganizationWorkspaceAction: { args: id => [id], min: 'admin', workspace: true },
    restartOrganizationWorkspaceAction: { args: id => [id], min: 'admin', workspace: true },
    deleteOrganizationWorkspaceAction: { args: id => [id], min: 'admin', workspace: true },
    openOrganizationWorkspaceAction: { args: id => [id], min: 'admin', workspace: true },
    listOrganizationWorkspaceMembersAction: { args: id => [id], reads: true, min: 'admin', workspace: true },
    inviteOrganizationWorkspaceMemberAction: { args: id => [id, 'new@acme.test', 'member'], min: 'admin', workspace: true },
    revokeOrganizationWorkspaceInvitationAction: { args: (id, _person, invitation) => [id, invitation], min: 'admin', workspace: true },
    removeOrganizationWorkspaceMemberAction: { args: (id, person) => [id, person], min: 'admin', workspace: true },
    setOrganizationWorkspaceMemberRoleAction: { args: (id, person) => [id, person, 'member'], min: 'admin', workspace: true },
    loadOrganizationCreditAction: { args: () => [], reads: true, min: 'admin', workspace: false },
    allocateOrganizationCreditAction: { args: id => [{ workspaceId: id, credits: 10, requestId: REQUEST }], min: 'admin', workspace: true },
    takeBackOrganizationCreditAction: { args: id => [{ workspaceId: id, credits: 10, requestId: REQUEST }], min: 'admin', workspace: true },
    listOrganizationTeamAction: { args: () => [], reads: true, min: 'admin', workspace: false },
    inviteOrganizationTeamMemberAction: { args: () => ['new@nordlys.test', 'admin'], min: 'owner', workspace: false },
    revokeOrganizationTeamInvitationAction: { args: (_id, _person, invitation) => [invitation], min: 'owner', workspace: false },
    setOrganizationTeamRoleAction: { args: (_id, person) => [person, 'owner'], min: 'owner', workspace: false },
    removeOrganizationTeamMemberAction: { args: (_id, person) => [person], min: 'owner', workspace: false },
    loadOrganizationBrandAction: { args: () => [], reads: true, min: 'admin', workspace: false },
    updateOrganizationBrandAction: { args: () => [form()], min: 'owner', workspace: false },
    listOrganizationDomainsAction: { args: () => [], reads: true, min: 'admin', workspace: false },
    addOrganizationDomainAction: { args: () => ['app.acme.com'], min: 'owner', workspace: false },
    checkOrganizationDomainAction: { args: (_id, _person, invitation) => [invitation], min: 'owner', workspace: false },
    removeOrganizationDomainAction: { args: (_id, _person, invitation) => [invitation], min: 'owner', workspace: false },
}
// Open to whoever holds the link, and to the person it was sent to.
const BY_INVITATION = ['loadOrganizationInvitationAction', 'acceptOrganizationInvitationAction']

const names = Object.keys(CONSOLE)
// Act on the caller's own organization, whatever they are given.
const ON_ITSELF = ['inviteOrganizationTeamMemberAction', 'updateOrganizationBrandAction', 'addOrganizationDomainAction']
const writes = names.filter(name => !CONSOLE[name].reads)
const onWorkspaces = names.filter(name => CONSOLE[name].workspace)
const ownerOnly = names.filter(name => CONSOLE[name].min === 'owner')

let world: OrganizationWorld

const run = (name: string, args: unknown[]) => (actions[name as ActionName] as (...args: unknown[]) => Promise<{ ok: boolean; code?: string }>)(...args)
const signedIn = (id: string | null) => mocks.getSessionIdentity.mockResolvedValue(id ? { id, email: EMAILS[id], is_anonymous: false, user_metadata: {}, app_metadata: {} } : null)
const written = () => world.chains.filter(chain => writeMethodOf(chain) || chain[0].table.startsWith('rpc:grant')).map(chain => chain[0].table)
const snapshot = () => JSON.stringify(world.tables)

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.enabled = true
    world = organizationWorld({
        organization_credit_movements: [
            { id: 'm1', organization_id: NORDLYS, seq: 1, kind: 'purchase', micros: 10_000_000, balance_after: 10_000_000, request_id: 'seed-1' },
            { id: 'm2', organization_id: HAVRE, seq: 1, kind: 'purchase', micros: 10_000_000, balance_after: 10_000_000, request_id: 'seed-2' },
        ],
        workspace_invitations: [{ id: WORKSPACE_INVITE, workspace_id: RIVAL_WORKSPACE, email: 'x@rival.test', status: 'pending', role: 'member', box_scope: 'all', token: 'ws-tok', created_at: '1' }],
        organization_domains: [{ id: TEAM_INVITE, organization_id: HAVRE, hostname: 'app.havre.test', status: 'active', verification_token: 'verify-x', problem: null, failing_since: null, verified_at: '1', last_checked_at: null, created_at: '1' }],
        organization_invitations: [{ id: TEAM_INVITE, organization_id: HAVRE, email: 'x@havre.test', status: 'pending', role: 'admin', token: 'team-tok', expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_at: '1' }],
    })
    Object.assign(world.rows('workspaces').find(row => row.id === RIVAL_WORKSPACE)!, { rerun_topup_micros: 5_000_000 })
    mocks.client = world.client
    signedIn(OWNER)
})

it('covers every action the console exports', () => {
    expect(Object.keys(actions).sort()).toEqual([...names, ...BY_INVITATION].sort())
})

describe('another organization', () => {
    it.each(onWorkspaces)('%s answers its workspace like one that does not exist, and changes nothing', async name => {
        const before = snapshot()
        const theirs = await run(name, CONSOLE[name].args(RIVAL_WORKSPACE, RIVAL_CLIENT, WORKSPACE_INVITE))
        const nobodys = await run(name, CONSOLE[name].args(987_654, RIVAL_CLIENT, WORKSPACE_INVITE))
        expect(theirs).toMatchObject({ ok: false, code: 'workspaceNotFound' })
        expect(theirs).toEqual(nobodys)
        expect(snapshot()).toBe(before)
        expect(mocks.machine).not.toHaveBeenCalled()
    })

    it.each(ownerOnly.filter(name => !ON_ITSELF.includes(name)))('%s does not reach what is its', async name => {
        const before = snapshot()
        const answer = await run(name, CONSOLE[name].args(CLIENT, RIVAL, TEAM_INVITE))
        expect(answer.ok).toBe(false)
        expect(['teamMemberNotFound', 'invitationNotFound', 'domainNotFound']).toContain(answer.code)
        expect(snapshot()).toBe(before)
    })

    it('does not lend its invitations or its members to a workspace of ours', async () => {
        const before = snapshot()
        expect(await run('revokeOrganizationWorkspaceInvitationAction', [CLIENT, WORKSPACE_INVITE])).toMatchObject({ ok: false, code: 'invitationNotFound' })
        expect(await run('removeOrganizationWorkspaceMemberAction', [CLIENT, RIVAL_CLIENT])).toMatchObject({ ok: false, code: 'userNotMember' })
        expect(await run('setOrganizationWorkspaceMemberRoleAction', [CLIENT, RIVAL_CLIENT, 'member'])).toMatchObject({ ok: false, code: 'userNotMember' })
        expect(snapshot()).toBe(before)
    })

    it('shows nothing of itself in a list', async () => {
        for (const name of ['listOrganizationWorkspacesAction', 'loadOrganizationCreditAction', 'listOrganizationTeamAction', 'loadOrganizationBrandAction', 'listOrganizationDomainsAction']) expect(JSON.stringify(await run(name, []))).not.toMatch(/Rival|havre|Havre/)
    })
})

describe('who may call', () => {
    it.each(names)('%s refuses a stranger, a client and a visitor', async name => {
        const before = snapshot()
        for (const id of [STRANGER, RIVAL_CLIENT]) {
            signedIn(id)
            expect(await run(name, CONSOLE[name].args(CLIENT, ADMIN, TEAM_INVITE))).toMatchObject({ ok: false, code: 'notAuthorized' })
        }
        signedIn(null)
        expect(await run(name, CONSOLE[name].args(CLIENT, ADMIN, TEAM_INVITE))).toMatchObject({ ok: false, code: 'notAuthenticated' })
        expect(snapshot()).toBe(before)
    })

    it.each(names)('%s refuses everyone on an install without organizations', async name => {
        mocks.enabled = false
        expect(await run(name, CONSOLE[name].args(CLIENT, ADMIN, TEAM_INVITE))).toMatchObject({ ok: false, code: 'notAuthorized' })
    })

    it.each(ownerOnly)('%s refuses an admin', async name => {
        signedIn(ADMIN)
        const before = snapshot()
        expect(await run(name, CONSOLE[name].args(CLIENT, OWNER, TEAM_INVITE))).toMatchObject({ ok: false, code: 'organizationOwnerOnly' })
        expect(snapshot()).toBe(before)
    })

    it.each(names.filter(name => !ownerOnly.includes(name)))('%s is an admin’s to call', async name => {
        signedIn(ADMIN)
        const answer = await run(name, CONSOLE[name].args(CLIENT, ADMIN, TEAM_INVITE))
        expect(['notAuthorized', 'organizationOwnerOnly', 'notAuthenticated']).not.toContain(answer.code)
    })
})

describe('a suspended organization', () => {
    beforeEach(() => {
        world.rows('organizations')[0].status = 'suspended'
    })

    it.each(writes)('%s is refused', async name => {
        const before = snapshot()
        expect(await run(name, CONSOLE[name].args(CLIENT, ADMIN, TEAM_INVITE))).toMatchObject({ ok: false, code: 'organizationSuspended' })
        expect(snapshot()).toBe(before)
        expect(written()).toEqual([])
    })

    it.each(names.filter(name => CONSOLE[name].reads))('%s still answers', async name => {
        expect(await run(name, CONSOLE[name].args(CLIENT, ADMIN, TEAM_INVITE))).toMatchObject({ ok: true })
    })
})

describe('what the browser sends', () => {
    const NOT_IDS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '20', null, undefined, {}, [CLIENT], 2 ** 60]

    it.each(onWorkspaces)('%s refuses anything that is not a workspace id', async name => {
        const before = snapshot()
        for (const bad of NOT_IDS) expect(await run(name, CONSOLE[name].args(bad as number, ADMIN, TEAM_INVITE))).toMatchObject({ ok: false, code: 'invalidRequest' })
        expect(snapshot()).toBe(before)
    })

    it.each(['allocateOrganizationCreditAction', 'takeBackOrganizationCreditAction'])('%s refuses anything that is not a whole, positive amount, or a request id', async name => {
        for (const credits of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null, 10_000_001]) expect(await run(name, [{ workspaceId: CLIENT, credits, requestId: REQUEST }])).toMatchObject({ ok: false, code: 'invalidRequest' })
        for (const requestId of ['', 'x', null, 7]) expect(await run(name, [{ workspaceId: CLIENT, credits: 5, requestId }])).toMatchObject({ ok: false, code: 'invalidRequest' })
        expect(world.rows('organization_credit_movements')).toHaveLength(2)
    })

    it('refuses a role that is not one', async () => {
        expect(await run('inviteOrganizationTeamMemberAction', ['new@nordlys.test', 'root'])).toMatchObject({ ok: false, code: 'invalidRequest' })
        expect(await run('setOrganizationTeamRoleAction', [ADMIN, 'root'])).toMatchObject({ ok: false, code: 'invalidRequest' })
        expect(await run('setOrganizationWorkspaceMemberRoleAction', [CLIENT, ADMIN, 'owner'])).toMatchObject({ ok: false, code: 'invalidRequest' })
        expect(await run('inviteOrganizationWorkspaceMemberAction', [CLIENT, 'new@acme.test', 'owner'])).toMatchObject({ ok: false, code: 'invalidRequest' })
    })

    it('is answered one of our own words, never a database’s', async () => {
        world = organizationWorld({}, table => (table === 'workspaces' ? { error: { message: 'relation "workspaces" is on fire' } } : undefined))
        mocks.client = world.client
        const answer = await run('archiveOrganizationWorkspaceAction', [CLIENT])
        expect(answer).toMatchObject({ ok: false, code: 'generic' })
        expect(JSON.stringify(answer)).not.toContain('fire')
    })
})

describe('the members of a client', () => {
    it('are invited as admins, and a pending invitation takes its new role', async () => {
        await run('inviteOrganizationWorkspaceMemberAction', [CLIENT, 'boss@acme.test', 'member'])
        await run('inviteOrganizationWorkspaceMemberAction', [CLIENT, 'boss@acme.test', 'admin'])
        expect(world.rows('workspace_invitations').filter(row => row.workspace_id === CLIENT)).toEqual([expect.objectContaining({ email: 'boss@acme.test', role: 'admin', status: 'pending' })])
    })

    it('keep an admin, and leave with an account that outlives the workspace', async () => {
        const [boss] = world.rows('workspace_members').filter(row => row.workspace_id === CLIENT)
        expect(await run('removeOrganizationWorkspaceMemberAction', [CLIENT, boss.user_id])).toMatchObject({ ok: false, code: 'needsAdmin' })
        world.rows('workspace_members').push({ ...boss, user_id: ADMIN, created_at: '2026-11-09' })

        expect(await run('removeOrganizationWorkspaceMemberAction', [CLIENT, boss.user_id])).toEqual({ ok: true })
        const home = world.rows('users').find(row => row.id === boss.user_id)!.workspace_id
        expect(home).not.toBe(CLIENT)
        expect(world.rows('workspace_members').some(row => row.user_id === boss.user_id && row.workspace_id === home)).toBe(true)
    })
})

describe('an invitation to the team', () => {
    it('is shown to whoever holds the link', async () => {
        await expect(actions.loadOrganizationInvitationAction('team-tok')).resolves.toEqual({ status: 'ok', email: 'x@havre.test', organizationName: 'Havre' })
        await expect(actions.loadOrganizationInvitationAction('')).resolves.toEqual({ status: 'not_found' })
        await expect(actions.loadOrganizationInvitationAction({ $ne: '' } as never)).resolves.toEqual({ status: 'not_found' })
    })

    it('asks a visitor to sign in, and refuses someone else', async () => {
        mocks.getAuthUser.mockResolvedValue(null)
        await expect(actions.acceptOrganizationInvitationAction('team-tok')).resolves.toMatchObject({ ok: false, code: 'signInToAcceptInvitation' })
        mocks.getAuthUser.mockResolvedValue({ id: STRANGER, email: EMAILS[STRANGER], identities: [] })
        await expect(actions.acceptOrganizationInvitationAction('team-tok')).resolves.toMatchObject({ ok: false, code: 'invitationForEmail' })
        mocks.getAuthUser.mockResolvedValue({ id: STRANGER, email: 'x@havre.test', identities: [] })
        await expect(actions.acceptOrganizationInvitationAction('team-tok')).resolves.toEqual({ ok: true, organizationId: HAVRE })
    })
})
