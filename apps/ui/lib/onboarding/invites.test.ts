import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const answers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/lib/foreman/profile', () => ({
    readAnswers: vi.fn(async () => answers.value),
    mergeForeman: vi.fn(async (_ctx: unknown, patch: Record<string, unknown>) => {
        answers.value = { ...answers.value, foreman: { ...(answers.value.foreman as object), ...patch } }
        return answers.value
    }),
}))
vi.mock('@/app/api/_services/workspace-invite.service', () => ({
    createWorkspaceInvite: vi.fn(async ({ email }: { email: string }) => (email.startsWith('full') ? { ok: false, email, code: 'seatLimit' } : email.startsWith('local') ? { ok: true, email, inviteUrl: `https://rerun.example/invite/${email}` } : { ok: true, email })),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@acme.test` } } }) } } }) }))

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { createWorkspaceInvite } from '@/app/api/_services/workspace-invite.service'
import { flushPendingInvites } from './invites'

const ctx = { userId: 'admin-1', userEmail: 'ada@acme.test', workspace: { id: 7, name: 'Acme', max_seats: 5 } } as unknown as WorkspaceContext

describe('flushPendingInvites', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        answers.value = { foreman: { pendingInvites: [{ email: 'bob@acme.test', invitedBy: 'admin-1' }, { email: 'full@acme.test', invitedBy: 'admin-2' }, { email: 'local@acme.test', invitedBy: 'admin-1' }] } }
    })

    it('sends every invitation once, on behalf of whoever typed it', async () => {
        const results = await flushPendingInvites(ctx)
        expect(results.map(result => result.ok)).toEqual([true, false, true])
        expect(createWorkspaceInvite).toHaveBeenCalledWith(expect.objectContaining({ email: 'bob@acme.test', inviterId: 'admin-1', inviterEmail: 'ada@acme.test', boxScope: 'all' }))
        expect(createWorkspaceInvite).toHaveBeenCalledWith(expect.objectContaining({ email: 'full@acme.test', inviterId: 'admin-2', inviterEmail: 'admin-2@acme.test' }))
        expect(await flushPendingInvites(ctx)).toEqual([])
        expect(createWorkspaceInvite).toHaveBeenCalledTimes(3)
    })

    it('keeps the links to pass on where no email leaves', async () => {
        await flushPendingInvites(ctx)
        expect((answers.value.foreman as { inviteLinks: unknown }).inviteLinks).toEqual([{ email: 'local@acme.test', link: 'https://rerun.example/invite/local@acme.test' }])
    })

    it('does nothing without pending invitations', async () => {
        answers.value = { foreman: {} }
        expect(await flushPendingInvites(ctx)).toEqual([])
        expect(createWorkspaceInvite).not.toHaveBeenCalled()
    })

    it('reports an invitation that threw as not sent, and goes on', async () => {
        vi.mocked(createWorkspaceInvite).mockRejectedValueOnce(new Error('db down'))
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const results = await flushPendingInvites(ctx)
        expect(results[0]).toEqual({ ok: false, email: 'bob@acme.test', code: 'sendInvitationFailed' })
        expect(results).toHaveLength(3)
        error.mockRestore()
    })
})
