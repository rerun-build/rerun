import { assertAgentInWorkspace } from '@/app/api/_auth/ownership'
import { publishWithThumbnail } from '@/lib/services/publish-thumbnail'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishFileAction } from './publish.actions'

vi.mock('@/app/api/_auth/ownership', () => ({ assertAgentInWorkspace: vi.fn(), requireWorkspaceContext: vi.fn(), requireWorkspaceId: vi.fn() }))
vi.mock('@/cloud/email', () => ({ EMAIL_DELIVERY: true }))
vi.mock('@/lib/services/publish-thumbnail', () => ({ publishWithThumbnail: vi.fn() }))
vi.mock('@/lib/services/publish', () => ({
    listPublished: vi.fn(),
    unpublishFile: vi.fn(),
}))

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
