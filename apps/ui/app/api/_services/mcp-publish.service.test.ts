import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    assertAgentInWorkspace: vi.fn(),
    visibleAgentIds: vi.fn(),
    assertPublishedLinkInReach: vi.fn(),
    getPublishedInWorkspace: vi.fn(),
    listWorkspacePublished: vi.fn(),
    unpublishInWorkspace: vi.fn(),
    updatePublishedAccess: vi.fn(),
    publishWithThumbnail: vi.fn(),
    getPageData: vi.fn(),
    updatePageData: vi.fn(),
    dispatchLibraryTool: vi.fn(),
    emailDelivery: { value: true },
}))

vi.mock('@rerun/cloud/email', () => ({
    get EMAIL_DELIVERY() {
        return mocks.emailDelivery.value
    },
}))
vi.mock('@/app/api/_auth/access', () => ({ assertAgentInWorkspace: mocks.assertAgentInWorkspace, visibleAgentIds: mocks.visibleAgentIds }))
vi.mock('@/lib/services/publish', () => ({
    assertPublishedLinkInReach: mocks.assertPublishedLinkInReach,
    getPublishedInWorkspace: mocks.getPublishedInWorkspace,
    listWorkspacePublished: mocks.listWorkspacePublished,
    unpublishInWorkspace: mocks.unpublishInWorkspace,
    updatePublishedAccess: mocks.updatePublishedAccess,
}))
vi.mock('@/lib/services/publish-thumbnail', () => ({ publishWithThumbnail: mocks.publishWithThumbnail }))
vi.mock('@/lib/services/published-data', () => ({ getPageData: mocks.getPageData, updatePageData: mocks.updatePageData }))
vi.mock('./mcp-library.service', () => ({ dispatchLibraryTool: mocks.dispatchLibraryTool }))

const { dispatchPublishTool } = await import('./mcp-publish.service')

const MEMBER: Actor = { kind: 'user', userId: 'u-ada', workspaceId: 7, role: 'member', boxScope: 'assigned' }

const link = (overrides: Record<string, unknown> = {}) => ({ slug: 'q1-k3m9', agentId: 'agent-lea', path: 'site', url: 'https://q1-k3m9.rerun.site', fileUrl: null, kind: 'site', contentType: 'text/html', size: 10, title: 'Q1', access: 'workspace', requestedAccess: null, invited: [], hasPassword: false, thumbnailUrl: 'https://thumb', publishedAt: '2026-11-25', updatedAt: '2026-11-26', ...overrides })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.emailDelivery.value = true
    mocks.visibleAgentIds.mockResolvedValue(new Set(['agent-lea']))
    mocks.getPublishedInWorkspace.mockResolvedValue(link())
    mocks.getPageData.mockResolvedValue({ listed: [], others: [{ database: 'shared', owner: null, table: 'leads', rows: 4 }] })
})

it('lists the links of the coworkers the caller reaches', async () => {
    mocks.listWorkspacePublished.mockResolvedValue([link(), link({ slug: 'other', agentId: 'agent-max' })])
    const out = (await dispatchPublishTool(MEMBER, 'list_published_pages', { agentId: 'agent-lea' })) as { links: { slug: string }[] }
    expect(mocks.listWorkspacePublished).toHaveBeenCalledWith(7, new Set(['agent-lea']))
    expect(out.links.map(entry => entry.slug)).toEqual(['q1-k3m9'])
    expect(JSON.stringify(out)).not.toContain('thumb')
})

it('publishes a file of a coworker it may use, as Publish in its Files tab', async () => {
    mocks.assertAgentInWorkspace.mockResolvedValue({ id: 'agent-lea' })
    mocks.publishWithThumbnail.mockResolvedValue({ slug: 'q1-k3m9', url: 'https://q1-k3m9.rerun.site', fileUrl: null, kind: 'site', title: 'Q1', access: 'workspace', message: 'Only the members…' })
    await expect(dispatchPublishTool(MEMBER, 'publish_file', { agentId: 'agent-lea', path: 'site' })).resolves.toMatchObject({ slug: 'q1-k3m9', access: 'workspace' })
    expect(mocks.assertAgentInWorkspace).toHaveBeenCalledWith('agent-lea', 'use', MEMBER)
    expect(mocks.publishWithThumbnail).toHaveBeenCalledWith('agent-lea', 'site')
})

describe('update_published_page', () => {
    it('reads the tables without changing anything when given the slug alone', async () => {
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9' })).resolves.toMatchObject({ slug: 'q1-k3m9', tables: { others: [{ table: 'leads' }] } })
        expect(mocks.assertPublishedLinkInReach).toHaveBeenCalledWith(MEMBER, 'q1-k3m9')
        expect(mocks.updatePublishedAccess).not.toHaveBeenCalled()
        expect(mocks.updatePageData).not.toHaveBeenCalled()
    })

    it('changes who may open it the way the share dialog does', async () => {
        mocks.updatePublishedAccess.mockResolvedValue(link({ access: 'invited', invited: ['bob@acme.test'] }))
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'invited', invite: ['bob@acme.test'] })).resolves.toMatchObject({ access: 'invited', invited: ['bob@acme.test'] })
        expect(mocks.updatePublishedAccess).toHaveBeenCalledWith(7, 'q1-k3m9', { access: 'invited', invite: ['bob@acme.test'] })
    })

    it('changes the access without reaching the machine, so a machine asleep does not turn a change made into an error', async () => {
        mocks.updatePublishedAccess.mockResolvedValue(link({ access: 'public' }))
        mocks.getPageData.mockRejectedValue(new Error('workspaceMachineUnreachable'))
        const out = await dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'public' })
        expect(out).toMatchObject({ access: 'public' })
        expect(out).not.toHaveProperty('tables')
        expect(mocks.getPageData).not.toHaveBeenCalled()
    })

    it('writes nothing when the tables are not a list', async () => {
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'public', tables: 'leads' })).rejects.toThrow('tables is a list')
        expect(mocks.updatePublishedAccess).not.toHaveBeenCalled()
        expect(mocks.updatePageData).not.toHaveBeenCalled()
    })

    it('writes the tables before the access: a machine that does not answer leaves the link as it was', async () => {
        mocks.updatePageData.mockRejectedValue(new Error('workspaceMachineUnreachable'))
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'public', tables: [] })).rejects.toThrow('workspaceMachineUnreachable')
        expect(mocks.updatePublishedAccess).not.toHaveBeenCalled()
    })

    it('refuses an access it does not know, and invites where no email leaves', async () => {
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'everyone' })).rejects.toThrow()
        mocks.emailDelivery.value = false
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'invited', invite: ['bob@acme.test'] })).rejects.toThrow()
        expect(mocks.updatePublishedAccess).not.toHaveBeenCalled()
    })

    it('gives the tables asked, and names the ones the caller could not give', async () => {
        mocks.updatePageData.mockResolvedValue({ listed: [{ database: 'shared', owner: null, table: 'leads', rows: 4, grant: 'write' }], others: [] })
        const out = (await dispatchPublishTool(MEMBER, 'update_published_page', {
            slug: 'q1-k3m9',
            tables: [
                { database: 'shared', table: 'leads', grant: 'write' },
                { database: 'agent-max', table: 'payroll', grant: 'read' },
            ],
        })) as { refused?: unknown[] }
        expect(mocks.updatePageData).toHaveBeenCalledWith(7, 'q1-k3m9', [
            { database: 'shared', table: 'leads', grant: 'write' },
            { database: 'agent-max', table: 'payroll', grant: 'read' },
        ], new Set(['agent-lea']))
        expect(out.refused).toEqual([{ database: 'agent-max', table: 'payroll', grant: 'read' }])
    })

    it('stops at a link published by a coworker out of reach', async () => {
        mocks.assertPublishedLinkInReach.mockRejectedValueOnce(new Error('Coworker not found'))
        await expect(dispatchPublishTool(MEMBER, 'update_published_page', { slug: 'q1-k3m9', access: 'public' })).rejects.toThrow('Coworker not found')
        expect(mocks.updatePublishedAccess).not.toHaveBeenCalled()
    })
})

it('takes a link down once confirmed', async () => {
    await expect(dispatchPublishTool(MEMBER, 'unpublish_page', { slug: 'q1-k3m9' })).rejects.toThrow('confirm: true')
    await expect(dispatchPublishTool(MEMBER, 'unpublish_page', { slug: 'q1-k3m9', confirm: true })).resolves.toEqual({ slug: 'q1-k3m9', unpublished: true })
    expect(mocks.unpublishInWorkspace).toHaveBeenCalledWith(7, 'q1-k3m9')
})

it('hands any other name to the template library', async () => {
    await dispatchPublishTool(MEMBER, 'search_template_library', {})
    expect(mocks.dispatchLibraryTool).toHaveBeenCalledWith(MEMBER, 'search_template_library', {})
})
