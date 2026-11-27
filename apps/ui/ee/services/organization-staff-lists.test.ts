import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryDatabase, type MemoryDatabase, type MemoryRow, type MemoryTables } from '@/ee/test/memory-database'
import { memberRow, workspaceRow } from '@/ee/test/organization-world'
import { writeMethodOf } from '@/test/supabase-fake'

const state = vi.hoisted(() => ({ db: null as unknown, viewer: 'member', heard: [] as unknown[][] }))
const told = vi.hoisted(() => (name: string, answer?: unknown) => (...args: unknown[]) => {
    state.heard.push([name, args])
    return Promise.resolve(answer)
})

const STAFF = '00000000-0000-4000-8000-0000000b0001'
const MEMBER = '00000000-0000-4000-8000-0000000b0002'
// Domains an email can leave for: `.test` is reserved, and nobody there is ever written to.
const EMAILS: Record<string, string> = { [STAFF]: 'staff@nordlys.io', [MEMBER]: 'member@acme.io' }
const WORKSPACE = 20
const BOX = 'box-1'

vi.mock('next/server', () => ({ after: (task: () => unknown) => void task() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => (state.db as MemoryDatabase).client }))
vi.mock('@/supabase/server', () => ({ createClient: async () => (state.db as MemoryDatabase).client }))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = async () => {
        const db = state.db as MemoryDatabase
        const row = db.rows('workspace_members').find(member => member.user_id === state.viewer && member.workspace_id === 20)
        return { user: { id: state.viewer, workspace_id: 20, locale: null }, workspace: db.rows('workspaces').find(workspace => workspace.id === 20), session: { id: state.viewer, email: 'me@acme.test', user_metadata: {}, app_metadata: {} }, membership: row ?? null, workspaceRefused: !row }
    }
    return { getServerSession: session, getSessionWorkspace: session, getSessionIdentity: async () => null, getAuthUser: async () => null }
})
vi.mock('@/lib/brand/workspace', async () => {
    const { RERUN_BRAND } = await import('@rerun/contracts')
    return { workspaceBrand: async () => ({ ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', iconUrl: 'https://cdn.test/nordlys.webp' }) }
})
vi.mock('@rerun/cloud/email', () => ({
    EMAIL_DELIVERY: true,
    BANNER_WARM_BACKGROUND_MS: 0,
    BANNER_WARM_INLINE_MS: 0,
    buildUnsubscribeUrl: () => 'https://app.test/unsubscribe',
    emailBoardBanner: async () => undefined,
    sendWorkspaceInviteEmail: told('invite', { ok: true }),
    sendNotificationEmail: told('notification email', { ok: true }),
    sendIncidentResolvedEmail: told('resolved email', { ok: true }),
    pushNotification: async (_db: unknown, push: { recipients: unknown; members: unknown }) => void state.heard.push(['push', push.recipients, push.members]),
}))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_BACKGROUND_MS: 0, BANNER_WARM_INLINE_MS: 0, emailBoardBanner: async () => undefined, teamBoardBanner: async () => undefined }))
vi.mock('@/app/api/_services/email.service', () => ({ sendBudgetExhaustedEmail: told('budget email', { ok: true }) }))
vi.mock('@/ee/lib/email/lifecycle-emails', () => ({ sendTrialStartedEmail: told('trial email', { ok: true }), sendPaymentFailedEmail: told('payment email', { ok: true }) }))
vi.mock('@/lib/email/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/email/client')>()), getResendClient: () => ({ emails: { send: told('email', { data: {} }) } }), redirectDelivery: (to: string, subject: string) => ({ to, subject }) }))
vi.mock('@/lib/email/throttle', () => ({ sendThrottled: (send: () => unknown) => send() }))
vi.mock('@/lib/whatsapp/send', () => ({ deliverWhatsApp: async (_db: unknown, message: { userId: string }) => (state.heard.push(['whatsapp', message.userId]), { sent: true, id: 'row' }) }))
vi.mock('@/lib/whatsapp/recipient', () => ({ loadWhatsAppRecipient: async (_db: unknown, userId: string) => (state.heard.push(['whatsapp recipient', userId]), { ok: false, reason: 'no_phone' }) }))
vi.mock('@rerun/analytics/server', () => ({ captureServer: told('analytics'), deterministicUuid: () => 'uuid' }))
vi.mock('@/lib/og/board-image', () => ({ boardImageUrl: () => 'https://app.test/board' }))
vi.mock('@/lib/templates/recommend', () => ({ loadRecommendCandidates: async () => [], recommendContext: () => ({}), shortlistTemplates: () => [] }))
vi.mock('@/lib/ai/generate-run-title', () => ({ generateRunTitle: async () => null }))
vi.mock('@/lib/foreman/agent-row', () => ({ ensureForemanAgentRow: async () => 'agent-cos' }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: async () => ({ workspaceId: 20, isSandbox: false }), findWorkspaceEngine: async () => null, getWorkspaceConnection: async () => ({}) }))
vi.mock('@/app/api/_services/chat.service', () => ({ ensureSessionRow: async () => 'session-1' }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: async () => {}, hasLinkedComputers: async () => true, listWorkspaceComputers: async () => ({ engine: 'ok', computers }) }))
vi.mock('@/app/api/_services/naming.service', () => ({ ensureWorkspaceNamed: async () => {} }))
vi.mock('@trigger.dev/sdk', () => ({ task: (definition: unknown) => definition, schemaTask: (definition: unknown) => definition, schedules: { task: (definition: unknown) => definition }, logger: {}, tasks: {}, queue: () => ({}), AbortTaskRunError: Error, metadata: {} }))

const computer = (id: string, linkedBy: string) => ({ id, name: id, handle: id, os: 'linux', arch: 'x64', hostname: id, app_version: '1', linked_by: linkedBy, created_at: '', last_seen_at: null, view: null })
const computers = [computer('mac', '00000000-0000-4000-8000-0000000b0001'), computer('pc', '00000000-0000-4000-8000-0000000b0002')]

const everythingOn = { scope: 'everything', email: true, toast: true, sound: true }

// One of the organization's team, there first, and one ordinary member: both admins, both with
// everything switched on.
function world(tables: MemoryTables = {}) {
    const user = (id: string) => ({ id, workspace_id: WORKSPACE, locale: null, signed_up_at: '2026-02-01T00:00:00.000Z', email_notification_prefs: everythingOn })
    const staff = memberRow(STAFF, WORKSPACE, { organization_staff: true })
    const member = memberRow(MEMBER, WORKSPACE)
    const db = memoryDatabase(
        {
            workspaces: [workspaceRow(WORKSPACE, { name: 'Acme', is_sandbox: false, organization_id: null, subscription_cancel_at: null, trial_started_at: null, trial_ends_at: null, onboarded_at: null, first_paid_at: null })],
            workspace_members: [staff, member],
            users: [user(STAFF), user(MEMBER)],
            workspace_invitations: [],
            spaces: [{ id: BOX, workspace_id: WORKSPACE, name: 'Sales', visibility: 'restricted' }],
            space_members: [STAFF, MEMBER].map(id => ({ space_id: BOX, workspace_id: WORKSPACE, user_id: id, access: 'use', granted_by: id, created_at: '2026-11-01' })),
            agents: [{ id: 'agent-1', name: 'Scout', workspace_id: WORKSPACE, space_id: BOX, kind: 'coworker', engine_agent_id: 'scout', disabled_at: null, created_at: '2026-11-01' }],
            sessions: [{ id: 'session-1', agent_id: 'agent-1', engine_session_id: 'engine-1', owner_user_id: null, source: 'dashboard', status: 'working', title: 'A' }],
            session_participants: [STAFF, MEMBER].map(id => ({ session_id: 'session-1', user_id: id, last_message_at: '2026-11-01' })),
            user_presence: [],
            notifications: [],
            workspace_onboarding: [],
            ...tables,
        },
        { emails: EMAILS, unique: { workspace_members: [['user_id', 'workspace_id']] }, defaults: { workspace_invitations: () => ({ status: 'pending' }) }, before: (table, calls) => (table === 'notifications' && writeMethodOf(calls) === 'insert' ? { data: { id: 'notification-1' } } : undefined) },
    )
    state.db = db
    return db
}

const contextOf = (db: MemoryDatabase, userId = MEMBER, organizationStaff = false) => ({ userId, organizationStaff, workspace: { id: WORKSPACE, name: 'Acme', max_seats: null }, role: 'admin', boxScope: 'all', authUser: { is_anonymous: false, user_metadata: {} }, supabase: db.client }) as never

beforeEach(() => {
    state.heard = []
    state.viewer = MEMBER
    vi.stubEnv('UNSUBSCRIBE_SECRET', 'secret')
    vi.stubEnv('LIFECYCLE_EMAILS_START_AT', '2026-01-01T00:00:00.000Z')
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

const NOW = new Date('2026-11-24T12:00:00.000Z')
const soon = new Date(NOW.getTime() + 12 * 60 * 60_000).toISOString()

type Case = { list: string; rows?: MemoryTables; workspace?: MemoryRow; run: (db: MemoryDatabase) => Promise<unknown> }

// Every list of the people of a workspace. Each is asked for its people, and what it answered, wrote
// and sent must name the member and never the staff.
const LISTS: Case[] = [
    { list: 'the members and the seats of the dialog', run: async db => (await import('@/app/api/_services/members.service')).listMembersAndInvites(db.client, WORKSPACE) },
    { list: 'who signs a message, and the directory of the app', run: async db => (await import('@/app/api/_services/members.service')).listMemberProfiles(contextOf(db)) },
    { list: 'the people of a Box and the members to pick from', run: async () => (await import('@/app/api/_actions/space-access.actions')).getSpaceAccessAction(BOX) },
    { list: 'the founder a workspace answers to', run: async () => (await import('@/app/api/_auth/ownership')).workspaceFounderUserId(WORKSPACE) },
    { list: 'the founder a check-in reads the workspace as', run: async () => (await import('@/lib/foreman/checkin-context')).founderContext(WORKSPACE).then(ctx => [ctx?.userId, ctx?.userEmail]) },
    { list: 'the owner analytics and emails know', run: async () => (await import('@/app/api/_services/workspace-owner.service')).resolveWorkspaceOwner(WORKSPACE) },
    { list: 'the reader of a routine of the Chief of Staff', run: async () => (await import('@/lib/foreman/conversation')).openForemanRoutineThread(WORKSPACE, 'engine-9', 'Monday') },
    {
        list: 'the audience of a notification: row, email and push',
        run: async () => (await import('@/app/api/_services/notification.service')).recordNotification('token', { event: 'agent.notification', kind: 'question', agentId: 'scout', sessionId: 'engine-1', runId: 'run-1', message: 'Which list?', timestamp: NOW.toISOString(), metadata: {} } as never),
    },
    { list: 'who hears that the credit is out', run: async () => (await import('@/ee/services/budgetNotification.service')).notifyBudgetExhausted(WORKSPACE) },
    { list: 'the emails of a paid app', run: async db => (await import('@/lib/apps/notify')).notifyWorkspace(db.client, WORKSPACE, { appName: 'LinkedIn', message: 'Paused', copy: { key: 'budgetExhausted' } as never, email: true }) },
    { list: 'the person behind the analytics of a paid app', run: async db => (await import('@/lib/apps/analytics')).reportWorkspaceEvent(db.client, WORKSPACE, 'app_connected' as never, {} as never) },
    { list: 'the WhatsApp message of an ending access', workspace: { subscription_cancel_at: soon }, run: async db => (await import('@/lib/whatsapp/access-ending')).sweepAccessEnding(db.client, NOW) },
    { list: 'the WhatsApp sequence of a trial', workspace: { subscription_status: 'trialing', trial_started_at: new Date(NOW.getTime() - 26 * 60 * 60_000).toISOString(), trial_ends_at: new Date(NOW.getTime() + 46 * 60 * 60_000).toISOString() }, run: async db => (await import('@/lib/whatsapp/trial-sequence')).sweepTrialSequence(db.client, NOW) },
    { list: 'the person a company exploration looks for', run: async db => (await import('@/trigger/explore-company')).readSignup(db.client, WORKSPACE) },
    { list: 'the receipt of a trial', run: async db => (await import('@/ee/lib/lifecycle/trial-receipt')).sendTrialStartedReceipt(db.client, WORKSPACE, soon, 3, true) },
    { list: 'the notice of a declined payment', run: async db => (await import('@/ee/lib/lifecycle/payment-failed-notice')).sendPaymentFailedNotice(db.client, WORKSPACE, { id: 'in_1', amountDueCents: 2900, currency: 'usd', hostedUrl: null, firstCharge: false }, NOW) },
    {
        list: 'the founder and the size of a team in the lifecycle emails',
        workspace: { onboarded_at: new Date(NOW.getTime() - 60 * 60_000).toISOString() },
        run: async db => {
            const context = await (await import('@/ee/lib/lifecycle/discovery')).loadLifecycleContext(db.client, NOW, [STAFF, MEMBER])
            const founder = context.snapshots.filter(snapshot => snapshot.isFounder)
            expect(founder.map(snapshot => snapshot.memberCount)).toEqual([1])
            return founder.map(snapshot => snapshot.userId)
        },
    },
]

describe('the team of an organization is in no list', () => {
    it.each(LISTS)('$list', async ({ rows, workspace, run }) => {
        const db = world(rows)
        Object.assign(db.rows('workspaces')[0], workspace)

        const answered = await run(db)

        const written = db.chains.flatMap(chain => chain.filter(call => ['insert', 'update', 'upsert'].includes(call.method)).map(call => call.args[0]))
        const shown = JSON.stringify([answered, state.heard, written])
        expect(shown, 'the member is there').toMatch(new RegExp(`${MEMBER}|${EMAILS[MEMBER]}`))
        expect(shown, 'the staff is not').not.toMatch(new RegExp(`${STAFF}|${EMAILS[STAFF]}`))
    })
})

describe('what counts people leaves them out', () => {
    it('neither takes a seat nor fills one', async () => {
        const db = world()
        const { inviteMember } = await import('@/app/api/_services/members.service')
        const invite = (max_seats: number) => inviteMember({ supabase: db.client, workspace: { id: WORKSPACE, name: 'Acme', max_seats }, invitedBy: { userId: MEMBER, email: null } }, 'new@acme.test')
        expect(await invite(1)).toEqual({ ok: false, code: 'seatLimit' })
        expect(await invite(2)).toEqual({ ok: true })
    })

    it('never stands in for the last admin of the client', async () => {
        const db = world()
        const { isLastAdmin, changeMemberRole } = await import('@/app/api/_services/members.service')
        expect(await isLastAdmin(db.client, WORKSPACE, MEMBER)).toBe(true)
        expect(await isLastAdmin(db.client, WORKSPACE, STAFF)).toBe(false)
        expect(await changeMemberRole(db.client, WORKSPACE, MEMBER, 'member')).toMatchObject({ ok: false, code: 'needsAdmin' })
    })
})

// A client that learned the id of someone of the team gets the answer of an id that does not exist.
const AIMED: { what: string; run: (db: MemoryDatabase) => Promise<unknown>; answer: unknown }[] = [
    { what: 'remove', run: async () => (await import('@/app/api/_actions/members.actions')).removeMemberAction(STAFF), answer: { ok: false, code: 'userNotMember' } },
    { what: 'demote', run: async () => (await import('@/app/api/_actions/members.actions')).setMemberRoleAction(STAFF, 'member'), answer: { ok: false, code: 'userNotMember' } },
    { what: 'narrow to some Boxes', run: async () => (await import('@/app/api/_actions/members.actions')).setMemberBoxScopeAction(STAFF, 'assigned'), answer: { ok: false, code: 'userNotMember' } },
    { what: 'give a Box to', run: async () => (await import('@/app/api/_actions/space-access.actions')).grantSpaceAccessAction(BOX, [STAFF], 'use'), answer: { ok: false, code: 'userNotMember' } },
    { what: 'read the Boxes of', run: async () => (await import('@/app/api/_actions/space-access.actions')).listMemberAccessAction(STAFF), answer: { ok: false, code: 'userNotMember' } },
    { what: 'credit a run to', run: async () => ({ email: await (await import('@/app/api/_services/workspace-owner.service')).resolveWorkspaceMemberEmail(WORKSPACE, STAFF) }), answer: { email: null } },
    { what: 'address a check-in to', run: async () => ({ reader: await (await import('@/lib/foreman/checkin-thread')).checkinReaderOf(WORKSPACE, { memberId: STAFF }) }), answer: { reader: null } },
]

describe('nobody aims at the team of an organization', () => {
    it.each(AIMED)('cannot $what them', async ({ run, answer }) => {
        const db = world()
        const before = JSON.stringify([db.rows('workspace_members'), db.rows('space_members')])
        expect(await run(db)).toMatchObject(answer as object)
        expect(JSON.stringify([db.rows('workspace_members'), db.rows('space_members')])).toBe(before)
    })

    it('makes no follower of them when their coworker writes a routine', async () => {
        const db = world()
        const { followAuthorOfCreatedTask } = await import('@/app/api/_services/notification-audience.service')
        await followAuthorOfCreatedTask(WORKSPACE, { event: 'agent.schedule.created', agentId: 'scout', metadata: { authorId: STAFF } } as never)
        expect(db.rows('users').find(user => user.id === STAFF)?.email_notification_prefs).toEqual(everythingOn)
    })
})

describe('what they do is signed by the brand', () => {
    const BRAND_PROFILE = { name: 'Nordlys', avatarUrl: 'https://cdn.test/nordlys.webp' }

    it('resolves the id their messages carry to the brand, for every reader', async () => {
        const db = world()
        const { listMemberProfiles } = await import('@/app/api/_services/members.service')
        expect(await listMemberProfiles(contextOf(db))).toEqual([expect.objectContaining({ id: MEMBER, role: 'admin' }), { id: 'organization', ...BRAND_PROFILE }])
    })

    it('resolves their own id to the brand too, for themselves alone', async () => {
        const db = world()
        const { listMemberProfiles } = await import('@/app/api/_services/members.service')
        expect((await listMemberProfiles(contextOf(db, STAFF, true))).slice(1)).toEqual([
            { id: 'organization', ...BRAND_PROFILE },
            { id: STAFF, ...BRAND_PROFILE },
        ])
    })

    it('signs their messages with the brand and no id of theirs', async () => {
        const db = world()
        const { messageAuthorOf } = await import('@/app/api/_services/me.service')
        const authUser = { email: EMAILS[STAFF], user_metadata: { full_name: 'Solveig Staff' } }
        expect(await messageAuthorOf({ ...(contextOf(db, STAFF, true) as object), authUser } as never, 'Europe/Oslo')).toEqual({ id: 'organization', name: 'Nordlys' })
        expect(await messageAuthorOf({ ...(contextOf(db, MEMBER) as object), authUser: { user_metadata: { full_name: 'Ada' } } } as never, 'Europe/Oslo')).toEqual({ id: MEMBER, name: 'Ada', timezone: 'Europe/Oslo' })
    })

    it('answers a card of a coworker as the brand when the Chief of Staff does it for them', async () => {
        world()
        const { memberActor } = await import('@/app/api/_auth/access')
        expect(await memberActor(WORKSPACE, STAFF)).toMatchObject({ organizationStaff: true })
        expect(await memberActor(WORKSPACE, MEMBER)).toMatchObject({ organizationStaff: false })
    })

    it('names the brand as whoever linked a computer', async () => {
        const db = world()
        const { workspaceComputerItems } = await import('@/app/api/_services/remote-computer-items.service')
        const { computers: items } = await workspaceComputerItems(contextOf(db))
        expect(items.map(item => item.linkedBy?.name)).toEqual(['Nordlys', expect.stringContaining('member')])
        expect(JSON.stringify(items)).not.toContain(STAFF)
    })

    it('invites in nobody’s name when one of them invites', async () => {
        world()
        state.viewer = STAFF
        const { inviteToWorkspaceAction } = await import('@/app/api/_actions/members.actions')
        expect(await inviteToWorkspaceAction('new@acme.test')).toEqual({ ok: true })
        await vi.waitFor(() => expect(state.heard).toHaveLength(1))
        expect(JSON.stringify(state.heard)).not.toContain('@nordlys.test')
        expect(JSON.stringify(state.heard)).not.toContain('me@acme.test')
    })

    it('tells the Chief of Staff it talks to the brand', async () => {
        const db = world()
        const { loadForemanState } = await import('@/lib/foreman/state')
        const ctx = { ...(contextOf(db, STAFF, true) as object), userEmail: EMAILS[STAFF], userLocale: null, authUser: { user_metadata: { first_name: 'Solveig' }, email: EMAILS[STAFF] } }
        const foreman = await loadForemanState(ctx as never, null)
        expect([foreman.userEmail, foreman.firstName]).toEqual(['Nordlys', 'Nordlys'])
    })

    it('records no participant, and still a read of their own', async () => {
        const { participantIdOf } = await import('@/app/api/_services/notification-audience.service')
        expect(participantIdOf({ userId: STAFF, organizationStaff: true })).toBeNull()
        expect(participantIdOf({ userId: MEMBER, organizationStaff: false })).toBe(MEMBER)
    })
})

describe('a run one of them started', () => {
    const finished = { event: 'agent.notification', kind: 'question', agentId: 'scout', sessionId: 'engine-1', runId: 'run-2', message: 'Which list?', timestamp: NOW.toISOString(), metadata: { authorId: 'organization' } }
    const record = async () => (await import('@/app/api/_services/notification.service')).recordNotification('token', finished as never)
    const recipients = (db: MemoryDatabase) => (db.writes('notifications')[0].payload as { recipients: unknown }).recipients
    const followed = { scope: 'all', email: true, coworkers: { 'agent-1': { follow: true } } }

    it('is nobody’s run here, and not one left unattended for its followers', async () => {
        const db = world({ session_participants: [] })
        for (const user of db.rows('users')) user.email_notification_prefs = followed
        await record()
        expect(recipients(db)).toEqual({})
    })

    it('still reaches a member who takes part in the conversation, as a participant', async () => {
        const db = world()
        for (const user of db.rows('users')) user.email_notification_prefs = followed
        await record()
        expect(recipients(db)).toEqual({ [MEMBER]: 'participant' })
    })

    it('is credited to nobody in analytics', async () => {
        world()
        await (await import('@/app/api/_services/notification.service')).recordNotification('token', { ...finished, event: 'agent.message.completed', kind: 'done' } as never)
        expect(state.heard.filter(([name]) => name === 'analytics')).toEqual([])
    })
})

describe('an organization alone in a workspace it sets up', () => {
    it('lets a turn of the Chief of Staff with nobody behind it act, and answers no founder', async () => {
        const db = world({ workspace_members: [memberRow(STAFF, WORKSPACE, { organization_staff: true })] })
        const { earliestOrganizationStaff } = await import('@/app/api/_auth/workspace-members')
        const { workspaceFounderUserId } = await import('@/app/api/_auth/ownership')
        expect(await workspaceFounderUserId(WORKSPACE)).toBeNull()
        expect(await earliestOrganizationStaff(db.client, WORKSPACE)).toBe(STAFF)
    })
})
