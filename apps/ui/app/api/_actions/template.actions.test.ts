import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({
    getAdminEmail: vi.fn(),
    getServerSession: vi.fn(),
    assertSpaceAccess: vi.fn(),
    hasTemplateEntitlement: vi.fn(),
    templateAccessByWorkspace: vi.fn(),
    installTemplate: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
    getAdminEmail: mocks.getAdminEmail,
    assertAdminUser: async () => {
        if (!(await mocks.getAdminEmail())) throw new Error('Unauthorized')
    },
}))
vi.mock('@/app/api/_auth/access', () => ({ assertSpaceAccess: mocks.assertSpaceAccess }))
vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/templates/entitlement', () => ({ hasTemplateEntitlement: mocks.hasTemplateEntitlement, templateAccessByWorkspace: mocks.templateAccessByWorkspace }))
vi.mock('@/lib/templates/install', () => ({ installTemplate: mocks.installTemplate }))
vi.mock('@/lib/templates/library', () => ({ LIBRARY_COLUMNS: ['id', 'slug', 'status', 'creator_id'], toLibraryTemplates: (rows: { slug: string }[]) => rows.map(row => ({ slug: row.slug })) }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { getSharedTemplateAction, installTemplateAction } = await import('./template.actions')

const WORKSPACE_ID = 7
const SPACE_ID = '11111111-1111-4111-8111-111111111111'
const AUTHOR = 'user-author'
const STRANGER = 'user-stranger'
const ACTOR = { kind: 'user', userId: STRANGER, workspaceId: WORKSPACE_ID, role: 'member', boxScope: 'all' }

type Template = { id: string; slug: string; status: string; creator_id: string; pricing_model: string }

function template(overrides: Partial<Template> = {}): Template {
    return { id: 'template-1', slug: 'crm', status: 'published', creator_id: AUTHOR, pricing_model: 'free', ...overrides }
}

function database(row: Template | null, subscriptionStatus: string | null = 'active'): FakeSupabase {
    const db = fakeSupabase(table => {
        if (table === 'templates') return { data: row }
        if (table === 'workspaces') return { data: { subscription_status: subscriptionStatus } }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

function signedInAs(userId: string | null) {
    mocks.getServerSession.mockResolvedValue({ user: userId ? { id: userId, workspace_id: WORKSPACE_ID } : null })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminEmail.mockResolvedValue(null)
    mocks.assertSpaceAccess.mockResolvedValue({ actor: ACTOR, access: 'manage' })
    mocks.hasTemplateEntitlement.mockResolvedValue(true)
    mocks.templateAccessByWorkspace.mockResolvedValue(new Map())
    mocks.installTemplate.mockResolvedValue({ imported: 1, inactive: 0, agentIds: ['agent-1'], failed: [], warnings: [] })
    signedInAs(STRANGER)
})

describe('installTemplateAction', () => {
    it('refuses a draft to a member who is neither its author nor an admin', async () => {
        database(template({ status: 'draft' }))

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'Unauthorized' })
        expect(mocks.installTemplate).not.toHaveBeenCalled()
    })

    it('lets the author install their own draft', async () => {
        signedInAs(AUTHOR)
        database(template({ status: 'draft' }), null)

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toMatchObject({ ok: true, imported: 1 })
        expect(mocks.installTemplate).toHaveBeenCalledWith(expect.anything(), 'crm', { workspaceId: WORKSPACE_ID, spaceId: SPACE_ID, actor: ACTOR, positions: undefined })
    })

    it('lets an admin install a template still in review', async () => {
        mocks.getAdminEmail.mockResolvedValue('admin@rerun.build')
        database(template({ status: 'in_review' }))

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toMatchObject({ ok: true })
    })

    it('refuses a published template on a workspace with no active plan', async () => {
        database(template(), 'canceled')

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'This workspace has no active plan.', code: 'noActivePlan' })
        expect(mocks.installTemplate).not.toHaveBeenCalled()
    })

    it('installs a published template on a trialing workspace', async () => {
        database(template(), 'trialing')

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toMatchObject({ ok: true })
    })

    it('refuses a paid template the workspace has not bought', async () => {
        database(template({ pricing_model: 'one_time' }))
        mocks.hasTemplateEntitlement.mockResolvedValue(false)

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'This template requires a purchase.', code: 'templateNeedsPurchase' })
        expect(mocks.hasTemplateEntitlement).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, expect.objectContaining({ id: 'template-1', pricing_model: 'one_time' }), STRANGER)
        expect(mocks.installTemplate).not.toHaveBeenCalled()
    })

    it('refuses a Box of another workspace before reading the template', async () => {
        const db = database(template())
        mocks.assertSpaceAccess.mockRejectedValue(new Error('Box not found'))

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'Box not found' })
        expect(db.chainsOn('templates')).toHaveLength(0)
    })

    it('asks for manage on the Box, so a member who only uses it installs nothing', async () => {
        database(template())
        mocks.assertSpaceAccess.mockRejectedValue(new Error('Only an admin or a manager of this Box can do this'))

        await expect(installTemplateAction({ slug: 'crm', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this' })
        expect(mocks.assertSpaceAccess).toHaveBeenCalledWith(SPACE_ID, 'manage')
        expect(mocks.installTemplate).not.toHaveBeenCalled()
    })

    it('refuses a space id that is not a uuid', async () => {
        database(template())

        await expect(installTemplateAction({ slug: 'crm', spaceId: 'nope' })).resolves.toMatchObject({ ok: false })
        expect(mocks.assertSpaceAccess).not.toHaveBeenCalled()
    })
})

describe('getSharedTemplateAction', () => {
    it('answers null to a stranger for a draft slug', async () => {
        database(template({ status: 'draft' }))

        await expect(getSharedTemplateAction('crm')).resolves.toBeNull()
    })

    it('answers null to a stranger for a template in review', async () => {
        database(template({ status: 'in_review' }))

        await expect(getSharedTemplateAction('crm')).resolves.toBeNull()
    })

    it('answers null to an anonymous visitor for a draft slug', async () => {
        signedInAs(null)
        database(template({ status: 'draft' }))

        await expect(getSharedTemplateAction('crm')).resolves.toBeNull()
    })

    it('opens an unlisted template to anyone holding its link', async () => {
        database(template({ status: 'unlisted' }))

        await expect(getSharedTemplateAction('crm')).resolves.toEqual({ slug: 'crm' })
    })

    it('lets the author preview their own draft', async () => {
        signedInAs(AUTHOR)
        database(template({ status: 'draft' }))

        await expect(getSharedTemplateAction('crm')).resolves.toEqual({ slug: 'crm' })
    })

    it('lets an admin preview a draft', async () => {
        mocks.getAdminEmail.mockResolvedValue('admin@rerun.build')
        database(template({ status: 'draft' }))

        await expect(getSharedTemplateAction('crm')).resolves.toEqual({ slug: 'crm' })
    })

    it('answers null for an unknown or empty slug', async () => {
        database(null)

        await expect(getSharedTemplateAction('missing')).resolves.toBeNull()
        await expect(getSharedTemplateAction('   ')).resolves.toBeNull()
    })
})
