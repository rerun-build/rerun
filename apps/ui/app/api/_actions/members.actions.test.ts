import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn(), sendWorkspaceInviteEmail: vi.fn(), afterTasks: [] as Promise<unknown>[], emailDelivery: true }))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@rerun/cloud/email', () => ({ get EMAIL_DELIVERY() { return mocks.emailDelivery }, sendWorkspaceInviteEmail: mocks.sendWorkspaceInviteEmail, BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn(async () => 'https://app.rerun.build/og/board?sig=x') }))
vi.mock('next/server', () => ({ after: (task: () => Promise<unknown>) => void mocks.afterTasks.push(task()) }))

// The invitation email leaves after the response, so a test reads it once those tasks settled.
const afterResponse = () => Promise.all(mocks.afterTasks.splice(0))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { acceptInvitationAction, inviteToWorkspaceAction, joinedWorkspaceForInvitationAction, listWorkspaceMembersAction, removeMemberAction, revokeInvitationAction, setMemberBoxScopeAction, setMemberRoleAction } = await import('./members.actions')

type Row = Record<string, unknown>

const WORKSPACE_ID = 7
const ME = 'user-me'
const DAY_MS = 24 * 60 * 60 * 1000

// Answers each read, and each write that returns its rows, from in-memory rows filtered on the chain's eq/in/is calls, the way PostgREST would.
function tableResolver(rows: Record<string, Row[]>) {
    return (table: string, calls: readonly SupabaseCall[]) => {
        if (writeMethodOf(calls) && !calls.some(call => call.method === 'select')) return undefined
        const matching = (rows[table] ?? []).filter(row =>
            calls.every(call => {
                if (call.method === 'eq') return row[call.args[0] as string] === call.args[1]
                if (call.method === 'in') return (call.args[1] as unknown[]).includes(row[call.args[0] as string])
                if (call.method === 'is') return row[call.args[0] as string] == null
                return true
            }),
        )
        const select = calls.find(call => call.method === 'select')
        if ((select?.args[1] as { head?: boolean } | undefined)?.head) return { count: matching.length }
        if (calls.some(call => call.method === 'maybeSingle' || call.method === 'single')) return { data: matching[0] ?? null }
        return { data: matching }
    }
}

function database(rows: Record<string, Row[]>, emails: Record<string, string> = {}): FakeSupabase {
    const db = fakeSupabase(tableResolver(rows))
    Object.assign(db.client, { auth: { admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { email: emails[id] } : null } }) } } })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

function signedIn(maxSeats: number | null = 3, email = 'me@acme.test') {
    mocks.getServerSession.mockResolvedValue({
        user: { id: ME, workspace_id: WORKSPACE_ID },
        workspace: { id: WORKSPACE_ID, name: 'Acme', max_seats: maxSeats },
        session: { id: ME, email },
        workspaceRefused: false,
    })
}

function member(userId: string, workspaceId = WORKSPACE_ID, role: 'admin' | 'member' = 'admin', boxScope: 'all' | 'assigned' = 'all'): Row {
    return { user_id: userId, workspace_id: workspaceId, role, box_scope: boxScope }
}

const plainMember = (userId: string) => member(userId, WORKSPACE_ID, 'member')

const linkedIdentity = (email: string, emailVerified = true) => ({ provider: 'google', identity_data: { email, email_verified: emailVerified } })

function pendingInvite(overrides: Row = {}): Row {
    return { id: 'invite-1', workspace_id: WORKSPACE_ID, email: 'new@acme.test', token: 'tok', status: 'pending', box_scope: 'all', expires_at: new Date(Date.now() + DAY_MS).toISOString(), ...overrides }
}

beforeEach(() => {
    vi.clearAllMocks()
    signedIn()
})

describe('inviteToWorkspaceAction', () => {
    it('refuses once members and pending invitations fill every seat', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2')], workspace_invitations: [pendingInvite({ id: 'other', email: 'other@acme.test' })] }, { [ME]: 'me@acme.test', 'user-2': 'two@acme.test' })

        const result = await inviteToWorkspaceAction('third@acme.test')

        expect(result).toEqual({ ok: false, error: 'This workspace has reached its seat limit.', code: 'seatLimit' })
        expect(db.writes('workspace_invitations')).toHaveLength(0)
        expect(mocks.sendWorkspaceInviteEmail).not.toHaveBeenCalled()
    })

    it('creates a pending invitation and emails it while a seat is free', async () => {
        const db = database({ workspace_members: [member(ME)], workspace_invitations: [pendingInvite({ id: 'other', email: 'other@acme.test' })] }, { [ME]: 'me@acme.test' })

        await expect(inviteToWorkspaceAction('  New@Acme.test ')).resolves.toEqual({ ok: true })
        await afterResponse()

        const [write] = db.writes('workspace_invitations')
        expect(write.method).toBe('insert')
        expect(write.payload).toMatchObject({ workspace_id: WORKSPACE_ID, email: 'new@acme.test', invited_by: ME, status: 'pending', box_scope: 'all' })
        expect(mocks.sendWorkspaceInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@acme.test', boardUrl: 'https://app.rerun.build/og/board?sig=x' }))
    })

    it('hands the link back to the person inviting where no email leaves', async () => {
        mocks.emailDelivery = false
        database({ workspace_members: [member(ME)], workspace_invitations: [pendingInvite()] }, { [ME]: 'me@acme.test' })

        const result = await inviteToWorkspaceAction('new@acme.test')

        expect(result).toEqual({ ok: true, inviteUrl: expect.stringMatching(/\/invite\/tok$/) })
        mocks.emailDelivery = true
    })

    it('re-sends a pending invitation without counting it against the seats again', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2')], workspace_invitations: [pendingInvite()] }, { [ME]: 'me@acme.test' })

        await expect(inviteToWorkspaceAction('new@acme.test')).resolves.toEqual({ ok: true })
        await afterResponse()

        expect(db.writes('workspace_invitations')).toHaveLength(0)
        expect(mocks.sendWorkspaceInviteEmail.mock.calls[0][0].inviteUrl).toMatch(/\/invite\/tok$/)
    })

    it('writes the scope chosen for the invitation', async () => {
        const db = database({ workspace_members: [member(ME)] }, { [ME]: 'me@acme.test' })

        await expect(inviteToWorkspaceAction('new@acme.test', 'assigned')).resolves.toEqual({ ok: true })

        expect(db.writes('workspace_invitations')[0]).toMatchObject({ method: 'insert', payload: { email: 'new@acme.test', box_scope: 'assigned' } })
    })

    it('gives a re-sent pending invitation the new scope', async () => {
        const db = database({ workspace_members: [member(ME)], workspace_invitations: [pendingInvite()] }, { [ME]: 'me@acme.test' })

        await expect(inviteToWorkspaceAction('new@acme.test', 'assigned')).resolves.toEqual({ ok: true })

        expect(db.writes('workspace_invitations')).toEqual([{ method: 'update', payload: { box_scope: 'assigned' }, filters: [{ table: 'workspace_invitations', method: 'eq', args: ['id', 'invite-1'] }] }])
    })

    it('refuses someone who is already a member', async () => {
        database({ workspace_members: [member(ME), member('user-2')] }, { [ME]: 'me@acme.test', 'user-2': 'two@acme.test' })

        await expect(inviteToWorkspaceAction('two@acme.test')).resolves.toEqual({ ok: false, error: 'This person is already a member of the workspace.', code: 'alreadyMember' })
    })

    it('invites without limit when the workspace has no seat cap', async () => {
        signedIn(null)
        const db = database({ workspace_members: [member(ME), member('user-2'), member('user-3')] }, { [ME]: 'me@acme.test' })

        await expect(inviteToWorkspaceAction('new@acme.test')).resolves.toEqual({ ok: true })
        expect(db.writes('workspace_invitations')).toHaveLength(1)
    })
})

describe('a member', () => {
    it('reads the members and their roles, and learns their own', async () => {
        database({ workspace_members: [member('user-2'), plainMember(ME)] }, { [ME]: 'me@acme.test', 'user-2': 'two@acme.test' })

        const result = await listWorkspaceMembersAction()

        expect(result).toMatchObject({ ok: true, currentRole: 'member', members: [{ userId: 'user-2', role: 'admin' }, { userId: ME, role: 'member' }] })
    })

    it('reads the scope of every member and of every pending invitation', async () => {
        database({ workspace_members: [member(ME), member('user-2', WORKSPACE_ID, 'member', 'assigned')], workspace_invitations: [pendingInvite({ box_scope: 'assigned' }), pendingInvite({ id: 'invite-2', email: 'two@acme.test' })] })

        const result = await listWorkspaceMembersAction()

        expect(result).toMatchObject({
            ok: true,
            members: [{ userId: ME, boxScope: 'all' }, { userId: 'user-2', boxScope: 'assigned' }],
            invites: [{ id: 'invite-1', boxScope: 'assigned' }, { id: 'invite-2', boxScope: 'all' }],
        })
    })

    it('cannot invite, revoke, remove nor change a role', async () => {
        const db = database({ workspace_members: [plainMember(ME), member('user-2')], workspace_invitations: [pendingInvite()], users: [{ id: 'user-2', workspace_id: 42 }] })
        const refused = { ok: false, error: 'Only an admin can manage members', code: 'adminOnlyMembers' }

        await expect(inviteToWorkspaceAction('new@acme.test')).resolves.toEqual(refused)
        await expect(revokeInvitationAction('invite-1')).resolves.toEqual(refused)
        await expect(removeMemberAction('user-2')).resolves.toEqual(refused)
        await expect(setMemberRoleAction(ME, 'admin')).resolves.toEqual(refused)
        await expect(setMemberBoxScopeAction(ME, 'all')).resolves.toEqual(refused)
        expect(db.writes('workspace_invitations')).toHaveLength(0)
        expect(db.writes('workspace_members')).toHaveLength(0)
    })
})

describe('setMemberRoleAction', () => {
    it('promotes a member', async () => {
        const db = database({ workspace_members: [member(ME), plainMember('user-2')] })

        await expect(setMemberRoleAction('user-2', 'admin')).resolves.toEqual({ ok: true })

        const [write] = db.writes('workspace_members')
        expect(write).toMatchObject({ method: 'update', payload: { role: 'admin' } })
    })

    it('lets an admin step down while another admin is left', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2')] })

        await expect(setMemberRoleAction(ME, 'member')).resolves.toEqual({ ok: true })
        expect(db.writes('workspace_members')[0]).toMatchObject({ method: 'update', payload: { role: 'member' } })
    })

    it('refuses to demote the last admin', async () => {
        const db = database({ workspace_members: [member(ME), plainMember('user-2')] })

        await expect(setMemberRoleAction(ME, 'member')).resolves.toEqual({ ok: false, error: 'The workspace needs at least one admin', code: 'needsAdmin' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('takes the role back when the other admin stepped down in the same instant', async () => {
        const rows = { workspace_members: [member(ME), member('user-2')] }
        const resolve = tableResolver(rows)
        // The other admin's demotion lands between the check and the write: every update of the
        // workspace_members table is applied, and the first one carries that concurrent demotion too.
        const db = fakeSupabase((table, calls) => {
            const update = calls.find(call => call.method === 'update')
            if (table === 'workspace_members' && update) {
                const userId = calls.find(call => call.method === 'eq' && call.args[0] === 'user_id')?.args[1]
                const target = rows.workspace_members.find(row => row.user_id === userId)
                if (target) Object.assign(target, update.args[0] as Row)
                if (db.writes('workspace_members').length === 1) rows.workspace_members[1].role = 'member'
            }
            return resolve(table, calls)
        })
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)

        await expect(setMemberRoleAction(ME, 'member')).resolves.toEqual({ ok: false, error: 'The workspace needs at least one admin', code: 'needsAdmin' })
        expect(db.writes('workspace_members').map(write => write.payload)).toEqual([{ role: 'member' }, { role: 'admin' }])
        expect(rows.workspace_members[0].role).toBe('admin')
    })

    it('refuses someone outside the workspace', async () => {
        database({ workspace_members: [member(ME), member('user-2', 99, 'member')] })

        await expect(setMemberRoleAction('user-2', 'admin')).resolves.toEqual({ ok: false, error: 'This user is not a member of the workspace.', code: 'userNotMember' })
    })
})

describe('setMemberBoxScopeAction', () => {
    it('narrows a member to the Boxes named to them', async () => {
        const db = database({ workspace_members: [member(ME), plainMember('user-2')] })

        await expect(setMemberBoxScopeAction('user-2', 'assigned')).resolves.toEqual({ ok: true })

        const [write] = db.writes('workspace_members')
        expect(write).toMatchObject({ method: 'update', payload: { box_scope: 'assigned' } })
        expect(write.filters.map(call => call.args)).toEqual([
            ['user_id', 'user-2'],
            ['workspace_id', WORKSPACE_ID],
        ])
    })

    it('leaves an admin alone, with the reason', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2')] })

        await expect(setMemberBoxScopeAction('user-2', 'assigned')).resolves.toEqual({ ok: false, error: 'Admins have access to every Box', code: 'adminsReachEveryBox' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('refuses someone outside the workspace', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2', 99, 'member')] })

        await expect(setMemberBoxScopeAction('user-2', 'assigned')).resolves.toEqual({ ok: false, error: 'This user is not a member of the workspace.', code: 'userNotMember' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('refuses a scope it does not know', async () => {
        database({ workspace_members: [member(ME), plainMember('user-2')] })

        await expect(setMemberBoxScopeAction('user-2', 'everything' as never)).resolves.toEqual({ ok: false, error: 'Unknown scope', code: 'unknownScope' })
    })
})

describe('revokeInvitationAction', () => {
    it('answers not found for an invitation of another workspace, without writing', async () => {
        const db = database({ workspace_members: [member(ME)], workspace_invitations: [pendingInvite({ workspace_id: 99 })] })

        await expect(revokeInvitationAction('invite-1')).resolves.toEqual({ ok: false, error: 'Invitation not found', code: 'invitationNotFound' })
        expect(db.writes('workspace_invitations')).toHaveLength(0)
    })

    it('revokes an invitation of the workspace', async () => {
        const db = database({ workspace_members: [member(ME)], workspace_invitations: [pendingInvite()] })

        await expect(revokeInvitationAction('invite-1')).resolves.toEqual({ ok: true })
        expect(db.writes('workspace_invitations')[0]).toMatchObject({ method: 'update', payload: { status: 'revoked' } })
    })
})

describe('removeMemberAction', () => {

    it('refuses to remove the caller', async () => {
        const db = database({ workspace_members: [member(ME)] })

        await expect(removeMemberAction(ME)).resolves.toEqual({ ok: false, error: 'You cannot remove yourself from the workspace.', code: 'cannotRemoveSelf' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('refuses a user who is not a member of the workspace', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2', 99)] })

        await expect(removeMemberAction('user-2')).resolves.toEqual({ ok: false, error: 'This user is not a member of the workspace.', code: 'userNotMember' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('refuses to remove a member from their only workspace', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2')], users: [{ id: 'user-2', workspace_id: WORKSPACE_ID }] })

        await expect(removeMemberAction('user-2')).resolves.toEqual({ ok: false, error: 'This is the only workspace of that user. They cannot be removed.', code: 'onlyWorkspaceOfUser' })
        expect(db.writes('users')).toHaveLength(0)
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('moves the member to another of their workspaces before removing the membership', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2'), member('user-2', 42)], users: [{ id: 'user-2', workspace_id: WORKSPACE_ID }] })

        await expect(removeMemberAction('user-2')).resolves.toEqual({ ok: true })

        expect(db.writes('users')).toEqual([{ method: 'update', payload: { workspace_id: 42 }, filters: [{ table: 'users', method: 'eq', args: ['id', 'user-2'] }] }])
        const [removal] = db.writes('workspace_members')
        expect(removal.method).toBe('delete')
        expect(removal.filters.map(call => call.args)).toEqual([
            ['user_id', 'user-2'],
            ['workspace_id', WORKSPACE_ID],
        ])
        const writeOrder = db.chains.filter(chain => writeMethodOf(chain)).map(chain => chain[0].table)
        expect(writeOrder).toEqual(['users', 'workspace_members'])
    })

    it('leaves the active workspace alone when the member is elsewhere', async () => {
        const db = database({ workspace_members: [member(ME), member('user-2')], users: [{ id: 'user-2', workspace_id: 42 }] })

        await expect(removeMemberAction('user-2')).resolves.toEqual({ ok: true })
        expect(db.writes('users')).toHaveLength(0)
        expect(db.writes('workspace_members')).toHaveLength(1)
    })
})

describe('acceptInvitationAction', () => {
    function signedInAs(email: string, identities: Row[] = []) {
        mocks.getServerSession.mockResolvedValue({ user: { id: ME, workspace_id: 1 }, session: { id: ME, email, identities } })
    }

    it('refuses an invitation meant for another email', async () => {
        signedInAs('someone@else.test')
        const db = database({ workspace_invitations: [pendingInvite()] })

        const result = await acceptInvitationAction('tok')

        expect(result).toEqual({ ok: false, error: 'This invitation is for new@acme.test. Sign in with that email to accept it.', code: 'invitationForEmail', params: { email: 'new@acme.test' } })
        expect(db.chains.filter(chain => writeMethodOf(chain))).toHaveLength(0)
    })

    it('matches the email whatever its case', async () => {
        signedInAs('NEW@acme.test')
        database({ workspace_invitations: [pendingInvite()] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })
    })

    it('accepts an invitation sent to the verified address of a Google account linked to the one signed in', async () => {
        signedInAs('primary@acme.test', [linkedIdentity('new@acme.test')])
        const db = database({ workspace_invitations: [pendingInvite()] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })
        expect(db.writes('workspace_members')[0].payload).toMatchObject({ user_id: ME, workspace_id: WORKSPACE_ID })
    })

    it('refuses an invitation sent to a linked address nobody verified', async () => {
        signedInAs('primary@acme.test', [linkedIdentity('new@acme.test', false)])
        const db = database({ workspace_invitations: [pendingInvite()] })

        await expect(acceptInvitationAction('tok')).resolves.toMatchObject({ ok: false, code: 'invitationForEmail' })
        expect(db.chains.filter(chain => writeMethodOf(chain))).toHaveLength(0)
    })

    it('refuses an expired invitation', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite({ expires_at: new Date(Date.now() - 1000).toISOString() })] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: false, error: 'This invitation has expired.', code: 'invitationExpired' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('refuses an invitation that is no longer pending', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite({ status: 'revoked' })] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: false, error: 'This invitation is no longer valid.', code: 'invitationInvalid' })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })

    it('refuses a visitor who is not signed in', async () => {
        mocks.getServerSession.mockResolvedValue({ user: null, session: null })
        database({ workspace_invitations: [pendingInvite()] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: false, error: 'You must be signed in to accept an invitation.', code: 'signInToAcceptInvitation' })
    })

    it('adds the membership, closes the invitation and makes the workspace active', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite()] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })

        expect(db.writes('workspace_members')).toEqual([{ method: 'insert', payload: { user_id: ME, workspace_id: WORKSPACE_ID, role: 'member', box_scope: 'all' }, filters: [] }])
        expect(db.writes('workspace_invitations')[0].payload).toMatchObject({ status: 'accepted' })
        expect(db.writes('users')[0]).toMatchObject({ payload: { workspace_id: WORKSPACE_ID }, filters: [{ method: 'eq', args: ['id', ME] }] })
    })

    it('joins as a member with the scope the invitation carries', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite({ box_scope: 'assigned' })] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })

        expect(db.writes('workspace_members')[0].payload).toEqual({ user_id: ME, workspace_id: WORKSPACE_ID, role: 'member', box_scope: 'assigned' })
    })

    it('accepts again without a second membership for someone already in the workspace', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite()], workspace_members: [member(ME)] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })

        expect(db.writes('workspace_members')).toHaveLength(0)
        expect(db.writes('users')[0].payload).toEqual({ workspace_id: WORKSPACE_ID })
    })

    it('claims the invitation only while it is still pending', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite()] })

        await acceptInvitationAction('tok')

        const [claim] = db.chainsOn('workspace_invitations').filter(chain => writeMethodOf(chain))
        expect(claim.filter(call => call.method === 'eq').map(call => call.args)).toEqual([
            ['id', 'invite-1'],
            ['status', 'pending'],
        ])
    })

    it('lets only one tab through when another already claimed the invitation', async () => {
        signedInAs('new@acme.test')
        const rows = { workspace_invitations: [pendingInvite()] }
        const read = tableResolver(rows)
        const db = fakeSupabase((table, calls) => (table === 'workspace_invitations' && writeMethodOf(calls) === 'update' ? { data: null } : read(table, calls)))
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: false, error: 'This invitation is no longer valid.', code: 'invitationInvalid' })
        expect(db.writes('workspace_members')).toHaveLength(0)
        expect(db.writes('users')).toHaveLength(0)
    })

    it('re-checks the seat limit at acceptance and hands the invitation back when the workspace is full', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite()], workspaces: [{ id: WORKSPACE_ID, max_seats: 2 }], workspace_members: [member('user-1'), member('user-2')] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: false, error: 'This workspace has no seat left. Ask an admin to free one.', code: 'noSeatLeft' })

        expect(db.writes('workspace_members')).toHaveLength(0)
        expect(db.writes('users')).toHaveLength(0)
        const [claim, release] = db.writes('workspace_invitations')
        expect(claim.payload).toMatchObject({ status: 'accepted' })
        expect(release.payload).toEqual({ status: 'pending', accepted_at: null })
        expect(release.filters.map(call => call.args)).toEqual([
            ['id', 'invite-1'],
            ['status', 'accepted'],
        ])
    })

    it('joins while a seat is left', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite()], workspaces: [{ id: WORKSPACE_ID, max_seats: 2 }], workspace_members: [member('user-1')] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })
        expect(db.writes('workspace_members')).toHaveLength(1)
        expect(db.writes('workspace_invitations')).toHaveLength(1)
    })

    it('lets a member already in a full workspace accept without taking a seat', async () => {
        signedInAs('new@acme.test')
        const db = database({ workspace_invitations: [pendingInvite()], workspaces: [{ id: WORKSPACE_ID, max_seats: 1 }], workspace_members: [member(ME)] })

        await expect(acceptInvitationAction('tok')).resolves.toEqual({ ok: true, workspaceId: WORKSPACE_ID })
        expect(db.writes('workspace_members')).toHaveLength(0)
    })
})

describe('joinedWorkspaceForInvitationAction', () => {
    function signedInAs(email: string, identities: Row[] = []) {
        mocks.getServerSession.mockResolvedValue({ user: { id: ME, workspace_id: WORKSPACE_ID }, session: { id: ME, email, identities } })
    }

    const acceptedInvite = (overrides: Row = {}) => pendingInvite({ status: 'accepted', ...overrides })

    it('lets in the member the accepted invitation was meant for, whatever the case of the email', async () => {
        signedInAs('NEW@acme.test')
        const db = database({ workspace_invitations: [acceptedInvite()], workspace_members: [member(ME)] })

        await expect(joinedWorkspaceForInvitationAction('tok')).resolves.toBe(WORKSPACE_ID)
        expect(db.chains.filter(chain => writeMethodOf(chain))).toHaveLength(0)
    })

    it('lets in the member who accepted through a linked Google account', async () => {
        signedInAs('primary@acme.test', [linkedIdentity('new@acme.test')])
        database({ workspace_invitations: [acceptedInvite()], workspace_members: [member(ME)] })

        await expect(joinedWorkspaceForInvitationAction('tok')).resolves.toBe(WORKSPACE_ID)
    })

    it('keeps a revoked invitation closed', async () => {
        signedInAs('new@acme.test')
        database({ workspace_invitations: [pendingInvite({ status: 'revoked' })], workspace_members: [member(ME)] })

        await expect(joinedWorkspaceForInvitationAction('tok')).resolves.toBeNull()
    })

    it('keeps the invitation closed to a member the owner removed since', async () => {
        signedInAs('new@acme.test')
        database({ workspace_invitations: [acceptedInvite()], workspace_members: [] })

        await expect(joinedWorkspaceForInvitationAction('tok')).resolves.toBeNull()
    })

    it('keeps the invitation closed to another account', async () => {
        signedInAs('someone@else.test')
        database({ workspace_invitations: [acceptedInvite()], workspace_members: [member(ME)] })

        await expect(joinedWorkspaceForInvitationAction('tok')).resolves.toBeNull()
    })

    it('keeps the invitation closed to a visitor who is not signed in', async () => {
        mocks.getServerSession.mockResolvedValue({ user: null, session: null })
        database({ workspace_invitations: [acceptedInvite()], workspace_members: [member(ME)] })

        await expect(joinedWorkspaceForInvitationAction('tok')).resolves.toBeNull()
    })
})
