import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForemanAnswers } from '@/lib/foreman/phase'
import type { ForemanIntake } from '@/lib/onboarding/intake'

const decideIndustry = vi.fn()
const readAnswers = vi.fn()
const writeAnswers = vi.fn()
const saveFirstName = vi.fn()
const analyzeCompanyProfile = vi.fn()
const requestCompanyExplore = vi.fn()
const ensureWorkspaceNamed = vi.fn()
const ctx = { userId: 'user-1', authUser: { id: 'user-1', is_anonymous: false }, workspace: { id: 7 }, role: 'admin', supabase: {} }

vi.mock('@/app/api/_auth/ownership', () => ({ requireAdminContext: async () => ctx }))
vi.mock('@/app/api/_services/naming.service', () => ({ ensureWorkspaceNamed: (...args: unknown[]) => ensureWorkspaceNamed(...args) }))
vi.mock('@/lib/brain/request-seed', () => ({ requestCompanyBrainSeed: vi.fn(), requestCompanyExplore: (...args: unknown[]) => requestCompanyExplore(...args) }))
vi.mock('@/lib/company/decide-industry', () => ({ decideIndustry: (...args: unknown[]) => decideIndustry(...args) }))
vi.mock('@/lib/company/firecrawl', () => ({ companySiteUrl: (input: string) => `https://${input.replace(/^https?:\/\//, '')}` }))
vi.mock('@/lib/company/profile', () => ({ analyzeCompanyProfile: (...args: unknown[]) => analyzeCompanyProfile(...args) }))
vi.mock('@/lib/foreman/profile', () => ({
    readAnswers: (...args: unknown[]) => readAnswers(...args),
    writeAnswers: (...args: unknown[]) => writeAnswers(...args),
    saveFirstName: (...args: unknown[]) => saveFirstName(...args),
}))

const { saveWelcomeIntakeAction, saveWelcomeSectorAction } = await import('./welcome.actions')

const INTAKE: ForemanIntake = { companyUrl: 'acme.com', industry: null, decidedIndustry: null, industryLabel: null, position: 'Founder / CEO', firstName: 'Ada' }

const written = () => writeAnswers.mock.calls[0][1] as ForemanAnswers

describe('saveWelcomeIntakeAction', () => {
    beforeEach(() => {
        readAnswers.mockReset().mockResolvedValue({})
        writeAnswers.mockReset().mockResolvedValue(undefined)
        saveFirstName.mockReset().mockResolvedValue(undefined)
        requestCompanyExplore.mockReset().mockResolvedValue(undefined)
        ensureWorkspaceNamed.mockReset().mockResolvedValue(undefined)
        analyzeCompanyProfile.mockReset().mockResolvedValue({ ok: true, analysis: { url: 'https://acme.com', profile: { name: 'Acme', description: 'Anvils', offering: 'Anvils', audience: 'Coyotes', industry: 'ecommerce' } } })
    })

    it('writes what the site says, and neither the chat funnel mark nor the onboarded stamp', async () => {
        expect(await saveWelcomeIntakeAction(INTAKE)).toEqual({ industry: 'ecommerce' })
        expect(written()).toMatchObject({ company_url: 'https://acme.com', company_name: 'Acme', industry: 'ecommerce', position: 'Founder / CEO', onboarding: { siteSkipped: false, siteIndustry: 'ecommerce' } })
        expect(written().foreman).toBeUndefined()
        expect(writeAnswers.mock.calls[0][2]).toBe(false)
        expect(saveFirstName).toHaveBeenCalledWith(ctx, 'Ada')
        expect(requestCompanyExplore).toHaveBeenCalledWith(ctx.supabase, 7, 'https://acme.com')
    })

    it('keeps the industry they picked over what the site was filed under', async () => {
        expect(await saveWelcomeIntakeAction({ ...INTAKE, industry: 'saas' })).toEqual({ industry: 'saas' })
    })

    it('falls back on the fast guess when the site could not be read', async () => {
        analyzeCompanyProfile.mockResolvedValue({ ok: false })
        expect(await saveWelcomeIntakeAction({ ...INTAKE, decidedIndustry: 'legal' })).toEqual({ industry: 'legal' })
        expect(written().company_url).toBe('https://acme.com')
    })

    it('files someone with no site under what they typed, so no question is asked twice', async () => {
        expect(await saveWelcomeIntakeAction({ ...INTAKE, companyUrl: null, industryLabel: 'Bakery' })).toEqual({ industry: 'other' })
        expect(written()).toMatchObject({ industry: 'other', company_offering: 'Bakery', onboarding: { siteSkipped: true, industryLabel: 'Bakery' } })
        expect(analyzeCompanyProfile).not.toHaveBeenCalled()
        expect(requestCompanyExplore).not.toHaveBeenCalled()
    })

    it('reads nothing off a platform address', async () => {
        await saveWelcomeIntakeAction({ ...INTAKE, companyUrl: 'linkedin.com/company/acme' })
        expect(analyzeCompanyProfile).not.toHaveBeenCalled()
        expect(written().company_url).toBeUndefined()
    })
})

describe('saveWelcomeSectorAction', () => {
    beforeEach(() => {
        readAnswers.mockReset().mockResolvedValue({})
        writeAnswers.mockReset().mockResolvedValue(undefined)
        decideIndustry.mockReset().mockResolvedValue(null)
    })

    it('files the line of work they picked under its category, and keeps which one it was', async () => {
        expect(await saveWelcomeSectorAction({ sector: 'consulting' })).toEqual({ ok: true, industry: 'agencies' })
        expect(written()).toMatchObject({ industry: 'agencies', onboarding: { sector: 'consulting' } })
        expect(decideIndustry).not.toHaveBeenCalled()
    })

    it('keeps their own words, filed where the fast decision puts them', async () => {
        decideIndustry.mockResolvedValue({ industry: 'legal' })
        expect(await saveWelcomeSectorAction({ label: ' Patent attorney ' })).toEqual({ ok: true, industry: 'legal' })
        expect(written()).toMatchObject({ industry: 'legal', company_offering: 'Patent attorney', onboarding: { industryLabel: 'Patent attorney' } })
    })

    it('forgets the words of the answer before when they change their mind', async () => {
        readAnswers.mockResolvedValue({ industry: 'other', company_offering: 'Bakery', onboarding: { industryLabel: 'Bakery' } })
        await saveWelcomeSectorAction({ sector: 'student' })
        expect(written()).toMatchObject({ industry: 'productivity', onboarding: { sector: 'student' } })
        expect(written().company_offering).toBeUndefined()
        expect(written().onboarding?.industryLabel).toBeUndefined()
    })

    it('refuses a line of work that does not exist, and an empty one', async () => {
        expect(await saveWelcomeSectorAction({ sector: 'falconry' })).toMatchObject({ ok: false })
        expect(await saveWelcomeSectorAction({ label: '  ' })).toMatchObject({ ok: false })
        expect(writeAnswers).not.toHaveBeenCalled()
    })
})
