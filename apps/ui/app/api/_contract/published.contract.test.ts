import { mobileApi } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { AppError } from '@/lib/i18n/action-error'
import type { PublishedFile } from '@/lib/services/types'
import { callRoute, contractContext, contractSessionUser, expectContract } from '@/test/mobile-contract'
import { fakeSupabase } from '@/test/supabase-fake'

type SessionWorkspace = Awaited<ReturnType<typeof import('@/supabase/session/getServerSession').getSessionWorkspace>>

// A link a coworker published, as the app's chat card reads it again and settles the public link the
// coworker asked for. The actions of the web run for real; the links themselves are faked.
const links = vi.hoisted(() => ({ getPublishedInWorkspace: vi.fn(), updatePublishedAccess: vi.fn(), dismissAccessRequest: vi.fn() }))
const state = vi.hoisted(() => ({ ctx: null as WorkspaceContext | null }))

vi.mock('@/lib/services/publish', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/services/publish')>()), ...links }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.ctx?.supabase }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
}))
vi.mock('@/supabase/session/getServerSession', async importOriginal => ({
    ...(await importOriginal<typeof import('@/supabase/session/getServerSession')>()),
    getSessionWorkspace: async (): Promise<SessionWorkspace> => ({
        supabase: state.ctx!.supabase,
        user: contractSessionUser('user-ada', 7),
        workspaceRefused: false,
        membership: { role: 'admin', box_scope: 'all', organization_staff: false },
    }),
}))

const SLUG = 'pricing-launch'

const file = (over: Partial<PublishedFile> = {}): PublishedFile => ({
    slug: SLUG,
    agentId: '5b0f8f7e-3c1d-4b8a-9f62-0d7c1e4a2b91',
    path: 'pages/pricing.html',
    url: 'https://pricing-launch.rerun.site/',
    fileUrl: null,
    kind: 'file',
    contentType: 'text/html',
    size: 18_420,
    title: 'Pricing page, November launch',
    access: 'workspace',
    requestedAccess: 'public',
    invited: ['grace@atelier-nord.fr'],
    hasPassword: false,
    thumbnailUrl: 'https://storage.rerun.build/thumbs/pricing-launch.png?token=t',
    publishedAt: '2026-11-26T09:00:00.000Z',
    updatedAt: '2026-11-26T09:00:00.000Z',
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
    state.ctx = contractContext(fakeSupabase())
})

describe('a published link, from the chat card of the app', () => {
    it('reads the link as it stands now, without the invited emails', async () => {
        links.getPublishedInWorkspace.mockResolvedValue(file())
        const { GET } = await import('@/app/api/v1/published/[slug]/route')

        const read = await expectContract(mobileApi.getPublishedLink, await callRoute(GET, mobileApi.getPublishedLink, { params: { slug: SLUG } }))

        expect(read).toEqual({ file: { slug: SLUG, url: 'https://pricing-launch.rerun.site/', path: 'pages/pricing.html', kind: 'file', contentType: 'text/html', title: 'Pricing page, November launch', access: 'workspace', requestedAccess: 'public', thumbnailUrl: 'https://storage.rerun.build/thumbs/pricing-launch.png?token=t', updatedAt: '2026-11-26T09:00:00.000Z' } })
        expect(links.getPublishedInWorkspace).toHaveBeenCalledWith(7, SLUG)
    })

    it('answers a null file once the link was unpublished', async () => {
        links.getPublishedInWorkspace.mockResolvedValue(null)
        const { GET } = await import('@/app/api/v1/published/[slug]/route')

        expect(await expectContract(mobileApi.getPublishedLink, await callRoute(GET, mobileApi.getPublishedLink, { params: { slug: SLUG } }))).toEqual({ file: null })
    })

    it('makes the link public, which settles the ask', async () => {
        links.updatePublishedAccess.mockResolvedValue(file({ access: 'public', requestedAccess: null }))
        const { PATCH } = await import('@/app/api/v1/published/[slug]/route')

        const changed = await expectContract(mobileApi.makePublishedLinkPublic, await callRoute(PATCH, mobileApi.makePublishedLinkPublic, { params: { slug: SLUG }, body: { access: 'public' } }))

        expect(changed).toMatchObject({ file: { access: 'public', requestedAccess: null } })
        expect(links.updatePublishedAccess).toHaveBeenCalledWith(7, SLUG, { access: 'public' })
    })

    it('says why the link could not go public', async () => {
        links.updatePublishedAccess.mockRejectedValue(new AppError('publicLinksOff'))
        const { PATCH } = await import('@/app/api/v1/published/[slug]/route')

        const refused = await expectContract(mobileApi.makePublishedLinkPublic, await callRoute(PATCH, mobileApi.makePublishedLinkPublic, { params: { slug: SLUG }, body: { access: 'public' } }), 400)

        expect(refused).toMatchObject({ code: 'publicLinksOff', error: 'Public links are turned off for this workspace.' })
    })

    it('refuses any other access: the app only settles the public link asked for', async () => {
        const { PATCH } = await import('@/app/api/v1/published/[slug]/route')

        await expectContract(mobileApi.makePublishedLinkPublic, await callRoute(PATCH, mobileApi.makePublishedLinkPublic, { params: { slug: SLUG }, body: { access: 'invited' } }), 400)
        expect(links.updatePublishedAccess).not.toHaveBeenCalled()
    })

    it('keeps the link private and drops the ask', async () => {
        links.dismissAccessRequest.mockResolvedValue(undefined)
        const { DELETE } = await import('@/app/api/v1/published/[slug]/access-request/route')

        expect(await expectContract(mobileApi.dismissPublishedAccessRequest, await callRoute(DELETE, mobileApi.dismissPublishedAccessRequest, { params: { slug: SLUG } }))).toBeUndefined()
        expect(links.dismissAccessRequest).toHaveBeenCalledWith(7, SLUG)
    })
})
