import { AuthorizationError } from '@/app/api/_auth/ownership'
import { assertAgentInWorkspace, requireLightSessionActor, visibleAgentIds, type Actor } from '@/app/api/_auth/access'
import { listWorkspacePublished, unpublishInWorkspace, updatePublishedAccess } from '@/lib/services/publish'
import { publishWithThumbnail } from '@/lib/services/publish-thumbnail'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorkspacePublishedAction, publishFileAction, unpublishLinkAction, updatePublishedAccessAction } from './publish.actions'

vi.mock('@/app/api/_auth/ownership', async () => ({ AuthorizationError: (await vi.importActual<typeof import('@/app/api/_auth/errors')>('@/app/api/_auth/errors')).AuthorizationError, requireAdminContext: vi.fn(), requireWorkspaceContext: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({
    assertAgentInWorkspace: vi.fn(),
    isAdminActor: (actor: Actor) => actor.kind === 'workspace' || actor.role === 'admin',
    requireLightSessionActor: vi.fn(),
    visibleAgentIds: vi.fn(),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@rerun/cloud/email', () => ({ EMAIL_DELIVERY: true }))
vi.mock('@/lib/services/publish-thumbnail', () => ({ publishWithThumbnail: vi.fn() }))
vi.mock('@/lib/services/publish', () => ({
    listPublished: vi.fn(),
    listWorkspacePublished: vi.fn(),
    unpublishFile: vi.fn(),
    unpublishInWorkspace: vi.fn(),
    updatePublishedAccess: vi.fn(),
}))

const ADMIN: Actor = { kind: 'user', userId: 'user-1', workspaceId: 1, role: 'admin', boxScope: 'all' }
const MEMBER: Actor = { kind: 'user', userId: 'user-2', workspaceId: 1, role: 'member', boxScope: 'assigned' }

describe('publishFileAction', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(assertAgentInWorkspace).mockResolvedValue({ workspace_id: 1, space_id: 'space', engine_agent_id: 'engine-agent' })
    })

    it('publishes an owned agent file without a billing entitlement check', async () => {
        vi.mocked(publishWithThumbnail).mockResolvedValue({
            status: 'published',
            url: 'https://file.rerun.test',
            slug: 'file',
            path: 'report.pdf',
            kind: 'file',
            contentType: 'application/pdf',
            size: 42,
            title: 'report.pdf',
            access: 'workspace',
            requestedAccess: null,
            message: 'Only the members of this workspace can open it, once signed in.',
        })

        await expect(publishFileAction('agent', 'report.pdf')).resolves.toEqual({
            success: true,
            url: 'https://file.rerun.test',
            slug: 'file',
        })
        expect(assertAgentInWorkspace).toHaveBeenCalledWith('agent')
        expect(vi.mocked(assertAgentInWorkspace).mock.calls[0]).toHaveLength(1)
        expect(publishWithThumbnail).toHaveBeenCalledWith('agent', 'report.pdf')
    })

    it('still refuses publishing when ownership verification fails', async () => {
        vi.mocked(assertAgentInWorkspace).mockRejectedValue(new Error('Agent not found'))

        await expect(publishFileAction('other-agent', 'report.pdf')).resolves.toEqual({
            success: false,
            error: 'Agent not found',
        })
        expect(publishWithThumbnail).not.toHaveBeenCalled()
    })
})

describe('listWorkspacePublishedAction', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(listWorkspacePublished).mockResolvedValue([])
    })

    it('narrows the list to the coworkers a member can see', async () => {
        const visible = new Set(['agent-seen'])
        vi.mocked(requireLightSessionActor).mockResolvedValue(MEMBER)
        vi.mocked(visibleAgentIds).mockResolvedValue(visible)

        await listWorkspacePublishedAction()
        expect(visibleAgentIds).toHaveBeenCalledWith(MEMBER)
        expect(listWorkspacePublished).toHaveBeenCalledWith(1, visible)
    })

    it('gives an admin the whole workspace', async () => {
        vi.mocked(requireLightSessionActor).mockResolvedValue(ADMIN)
        vi.mocked(visibleAgentIds).mockResolvedValue('all')

        await listWorkspacePublishedAction()
        expect(listWorkspacePublished).toHaveBeenCalledWith(1, 'all')
    })
})

describe('links reached by their slug', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(table => (table === 'published_files' ? { data: { agent_id: 'agent-hidden' } } : undefined)).client)
    })

    it('refuses a member a link published by a coworker they cannot reach', async () => {
        vi.mocked(requireLightSessionActor).mockResolvedValue(MEMBER)
        vi.mocked(assertAgentInWorkspace).mockRejectedValue(new AuthorizationError('coworkerNotFound'))

        await expect(unpublishLinkAction('report')).resolves.toEqual({ ok: false, error: 'Coworker not found', code: 'coworkerNotFound' })
        await expect(updatePublishedAccessAction('report', { access: 'public' } as never)).resolves.toEqual({ ok: false, error: 'Coworker not found', code: 'coworkerNotFound' })
        expect(assertAgentInWorkspace).toHaveBeenCalledWith('agent-hidden', 'use', MEMBER)
        expect(unpublishInWorkspace).not.toHaveBeenCalled()
        expect(updatePublishedAccess).not.toHaveBeenCalled()
    })

    it('lets a member who uses the coworker unpublish its link', async () => {
        vi.mocked(requireLightSessionActor).mockResolvedValue(MEMBER)
        vi.mocked(assertAgentInWorkspace).mockResolvedValue({ workspace_id: 1, space_id: 'space', engine_agent_id: 'engine-agent' })

        await expect(unpublishLinkAction('report')).resolves.toEqual({ ok: true })
        expect(unpublishInWorkspace).toHaveBeenCalledWith(1, 'report')
    })

    it('lets an admin through without reading the coworker', async () => {
        vi.mocked(requireLightSessionActor).mockResolvedValue(ADMIN)

        await expect(unpublishLinkAction('report')).resolves.toEqual({ ok: true })
        expect(assertAgentInWorkspace).not.toHaveBeenCalled()
        expect(unpublishInWorkspace).toHaveBeenCalledWith(1, 'report')
    })
})
