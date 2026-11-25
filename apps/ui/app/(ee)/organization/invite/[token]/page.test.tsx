import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enabled: true, load: vi.fn(), accept: vi.fn(), account: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ get ORGANIZATIONS_ENABLED() { return mocks.enabled } }))
vi.mock('@/ee/actions/organization.actions', () => ({ loadOrganizationInvitationAction: mocks.load, acceptOrganizationInvitationAction: mocks.accept }))
vi.mock('@/ee/services/organization-team.service', () => ({ teamInvitationPath: (token: string) => `/organization/invite/${token}` }))
vi.mock('@/supabase/session/getServerSession', () => ({ getAuthUser: mocks.account }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('next/navigation', () => ({
    notFound: () => {
        throw new Error('NOT FOUND')
    },
    redirect: (to: string) => {
        throw new Error(`REDIRECT ${to}`)
    },
}))
const { default: TeamInvitePage } = await import('./page')
const { InviteCard } = await import('@/app/(authflow)/invite/[token]/InviteCard')
const { InviteMismatch } = await import('@/app/(authflow)/invite/[token]/InviteMismatch')
const { InviteRedirect } = await import('@/app/(authflow)/invite/[token]/InviteRedirect')

const EMAIL = 'ines@nordlys.test'
const signedIn = (email: string) => mocks.account.mockResolvedValue({ id: 'u', email, identities: [], email_confirmed_at: '2026-11-01T00:00:00Z' })

async function open(): Promise<ReactElement<Record<string, string>>> {
    const page = await TeamInvitePage({ params: Promise.resolve({ token: 'tok' }) })
    if (!isValidElement(page)) throw new Error('no page')
    return page as ReactElement<Record<string, string>>
}

beforeEach(() => {
    mocks.enabled = true
    mocks.load.mockReset().mockResolvedValue({ status: 'ok', email: EMAIL, organizationName: 'Nordlys' })
    mocks.accept.mockReset().mockResolvedValue({ ok: true, organizationId: 'o' })
    mocks.account.mockReset().mockResolvedValue(null)
})

describe('an invitation to the team of an organization', () => {
    it('sends a visitor to the sign-in as the address it was sent to, and back here', async () => {
        const page = await open()
        expect(page.type).toBe(InviteRedirect)
        expect(page.props).toMatchObject({ next: '/organization/invite/tok', email: EMAIL, title: 'You are invited to the team of Nordlys' })
        expect(mocks.accept).not.toHaveBeenCalled()
    })

    it('lets the person it names in', async () => {
        signedIn(EMAIL)
        await expect(open()).rejects.toThrow('REDIRECT /organization')
        expect(mocks.accept).toHaveBeenCalledWith('tok')
    })

    it('is not accepted by another account', async () => {
        signedIn('someone@else.test')
        const page = await open()
        expect(page.type).toBe(InviteMismatch)
        expect(page.props).toMatchObject({ inviteEmail: EMAIL, currentEmail: 'someone@else.test' })
        expect(mocks.accept).not.toHaveBeenCalled()
    })

    it.each([
        ['not_found', 'Invitation not found'],
        ['expired', 'Invitation expired'],
        ['unavailable', 'Invitation unavailable'],
    ])('says it is %s, signed out', async (status, title) => {
        mocks.load.mockResolvedValue({ status })
        const page = await open()
        expect(page.type).toBe(InviteCard)
        expect(page.props.title).toBe(title)
        expect(mocks.accept).not.toHaveBeenCalled()
    })

    it('leads whoever it already let in to the console, and nobody else', async () => {
        mocks.load.mockResolvedValue({ status: 'unavailable' })
        signedIn(EMAIL)
        await expect(open()).rejects.toThrow('REDIRECT /organization')
        mocks.accept.mockResolvedValue({ ok: false, error: 'x', code: 'invitationInvalid' })
        expect((await open()).props.title).toBe('Invitation unavailable')
    })

    it('says why it could not be accepted', async () => {
        signedIn(EMAIL)
        mocks.accept.mockResolvedValue({ ok: false, error: 'x', code: 'organizationSuspended' })
        expect((await open()).props).toMatchObject({ title: 'Could not join the team', message: 'Your organization is suspended. Nothing can be changed for now.' })
    })

    it('does not exist on an install without organizations', async () => {
        mocks.enabled = false
        await expect(open()).rejects.toThrow('NOT FOUND')
        expect(mocks.load).not.toHaveBeenCalled()
    })
})
