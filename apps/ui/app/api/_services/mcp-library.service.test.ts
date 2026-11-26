import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    assertSpaceAccess: vi.fn(),
    templateAccessByWorkspace: vi.fn(),
    installTemplate: vi.fn(),
    assertTemplateInstallable: vi.fn(),
    selectMany: vi.fn(),
    selectMaybeSingle: vi.fn(),
    dispatchVaultTool: vi.fn(),
}))

vi.mock('@/app/api/_auth/access', () => ({ assertSpaceAccess: mocks.assertSpaceAccess }))
vi.mock('@/lib/templates/entitlement', () => ({ templateAccessByWorkspace: mocks.templateAccessByWorkspace }))
vi.mock('@/lib/templates/install', () => ({ installTemplate: mocks.installTemplate }))
vi.mock('@/lib/templates/install-guard', () => ({ assertTemplateInstallable: mocks.assertTemplateInstallable }))
vi.mock('@/lib/templates/library', () => ({
    LIBRARY_COLUMNS: ['slug'],
    toLibraryTemplates: (rows: Record<string, unknown>[]) => rows.map(row => ({ tags: [], connectors: [], pricing: { model: 'free', amountCents: 0, currency: 'usd' }, setupMinutes: 5, featured: false, owned: true, archiveAgentNames: ['Scout'], ...row })),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ service: true }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: mocks.selectMany, selectMaybeSingle: mocks.selectMaybeSingle }))
vi.mock('./mcp-vault.service', () => ({ dispatchVaultTool: mocks.dispatchVaultTool }))

const { dispatchLibraryTool } = await import('./mcp-library.service')

const MEMBER: Actor = { kind: 'user', userId: 'u-ada', workspaceId: 7, role: 'member', boxScope: 'all' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.templateAccessByWorkspace.mockResolvedValue(new Map())
    mocks.selectMaybeSingle.mockResolvedValue({ data: { organization_id: null } })
    mocks.selectMany.mockResolvedValue({
        data: [
            { slug: 'linkedin-ghostwriter', title: 'LinkedIn ghostwriter', tagline: 'Posts every week', category: 'creators' },
            { slug: 'crm', title: 'CRM', tagline: 'Leads', category: 'sales', featured: true, owned: false, pricing: { model: 'one_time', amountCents: 4900, currency: 'usd' } },
            { slug: 'editorial', title: 'Editorial only', tagline: '', category: 'sales', archiveAgentNames: [] },
        ],
    })
})

describe('search_template_library', () => {
    it('lists what can be installed, featured first, with its price and whether it is owned', async () => {
        const out = (await dispatchLibraryTool(MEMBER, 'search_template_library', {})) as { templates: { slug: string; owned: boolean }[]; total: number }
        expect(out.total).toBe(2)
        expect(out.templates.map(({ slug, owned }) => ({ slug, owned }))).toEqual([
            { slug: 'crm', owned: false },
            { slug: 'linkedin-ghostwriter', owned: true },
        ])
        expect(mocks.selectMany).toHaveBeenCalledWith({ service: true }, 'templates', ['slug'], { status: 'published', show_in_library: true }, { column: 'published_at', ascending: false })
    })

    it('filters by words and category', async () => {
        await expect(dispatchLibraryTool(MEMBER, 'search_template_library', { query: 'WEEK' })).resolves.toMatchObject({ total: 1, templates: [{ slug: 'linkedin-ghostwriter' }] })
        await expect(dispatchLibraryTool(MEMBER, 'search_template_library', { category: 'sales' })).resolves.toMatchObject({ total: 1, templates: [{ slug: 'crm' }] })
    })

    it('shows a workspace an organization manages only what it already holds', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { organization_id: 'org-1' } })
        await expect(dispatchLibraryTool(MEMBER, 'search_template_library', {})).resolves.toMatchObject({ total: 1, templates: [{ slug: 'linkedin-ghostwriter' }] })
    })
})

describe('install_template', () => {
    it('checks the Box, then the template, before installing', async () => {
        mocks.installTemplate.mockResolvedValue({ imported: 2, inactive: 0, agentIds: ['a1', 'a2'], failed: [], warnings: [], alreadyInstalled: false })
        await expect(dispatchLibraryTool(MEMBER, 'install_template', { slug: 'crm', spaceId: 'box-sales' })).resolves.toEqual({ installed: 2, inactive: 0, agentIds: ['a1', 'a2'] })
        expect(mocks.assertSpaceAccess).toHaveBeenCalledWith('box-sales', 'manage', MEMBER)
        expect(mocks.assertTemplateInstallable).toHaveBeenCalledWith({ service: true }, 'crm', { workspaceId: 7, userId: 'u-ada', isPlatformAdmin: false })
        expect(mocks.installTemplate).toHaveBeenCalledWith({ service: true }, 'crm', { workspaceId: 7, spaceId: 'box-sales', actor: MEMBER })
    })

    it('installs nothing when a check refuses', async () => {
        mocks.assertTemplateInstallable.mockRejectedValueOnce(new Error('This template requires a purchase.'))
        await expect(dispatchLibraryTool(MEMBER, 'install_template', { slug: 'crm', spaceId: 'box-sales' })).rejects.toThrow('purchase')
        mocks.assertSpaceAccess.mockRejectedValueOnce(new Error('Box not found'))
        await expect(dispatchLibraryTool(MEMBER, 'install_template', { slug: 'crm', spaceId: 'elsewhere' })).rejects.toThrow('Box not found')
        expect(mocks.installTemplate).not.toHaveBeenCalled()
    })

    it('says a template already installed gave back its coworkers', async () => {
        mocks.installTemplate.mockResolvedValue({ imported: 0, inactive: 0, agentIds: ['a1'], failed: [], warnings: [], alreadyInstalled: true })
        await expect(dispatchLibraryTool(MEMBER, 'install_template', { slug: 'crm', spaceId: 'box-sales' })).resolves.toMatchObject({ alreadyInstalled: true, agentIds: ['a1'] })
    })
})

it('hands any other name to the Vault', async () => {
    await dispatchLibraryTool(MEMBER, 'list_vault', {})
    expect(mocks.dispatchVaultTool).toHaveBeenCalledWith(MEMBER, 'list_vault', {})
})
