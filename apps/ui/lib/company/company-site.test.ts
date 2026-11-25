import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForemanAnswers } from '@/lib/foreman/phase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), readAnswers: vi.fn(), writeAnswers: vi.fn(), explore: vi.fn(), seed: vi.fn(), named: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/company/profile', () => ({ analyzeCompanyProfile: mocks.analyze }))
vi.mock('@/lib/foreman/profile', () => ({ readAnswers: mocks.readAnswers, writeAnswers: mocks.writeAnswers }))
vi.mock('@/lib/brain/request-seed', () => ({ requestCompanyExplore: mocks.explore, requestCompanyBrainSeed: mocks.seed }))
vi.mock('@/app/api/_services/naming.service', () => ({ ensureWorkspaceNamed: mocks.named }))

const { readCompanySite, saveCompanySite, skipCompanySite } = await import('./company-site')

const PROFILE = { name: 'Acme', description: 'Anvils', offering: 'Anvils by mail', audience: 'Coyotes', industry: 'ecommerce' }
const scope = { supabase: {} as SupabaseClient<Database>, workspaceId: 7, userId: 'user-1' }
const written = () => mocks.writeAnswers.mock.calls[0][1] as ForemanAnswers

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.readAnswers.mockResolvedValue({})
    mocks.explore.mockResolvedValue(undefined)
    mocks.seed.mockResolvedValue(true)
    mocks.analyze.mockResolvedValue({ ok: true, analysis: { url: 'https://acme.com', profile: PROFILE } })
})

describe('readCompanySite', () => {
    it('reads what a site says, and keeps the address alone when it says nothing', async () => {
        expect(await readCompanySite('acme.com')).toEqual({ url: 'https://acme.com', profile: PROFILE, industry: 'ecommerce' })
        mocks.analyze.mockResolvedValue({ ok: false, error: 'blocked' })
        expect(await readCompanySite('acme.com')).toMatchObject({ profile: null, industry: null })
    })

    it('reads nothing off a platform, nor what is no address', async () => {
        expect(await readCompanySite('linkedin.com/company/acme')).toBeNull()
        expect(await readCompanySite('not a site')).toBeNull()
        expect(mocks.analyze).not.toHaveBeenCalled()
    })
})

describe('saveCompanySite', () => {
    it('writes the profile, asks for the Brain again and renames the workspace, outside the chat funnel', async () => {
        await saveCompanySite(scope, { url: 'https://acme.com', profile: { ...PROFILE, industry: 'ecommerce' }, industry: 'ecommerce' })
        expect(written()).toMatchObject({ company_url: 'https://acme.com', company_name: 'Acme', industry: 'ecommerce', onboarding: { siteSkipped: false } })
        expect(written().foreman).toBeUndefined()
        expect(mocks.writeAnswers.mock.calls[0][2]).toBe(false)
        expect(mocks.explore).toHaveBeenCalledWith(scope.supabase, 7, 'https://acme.com')
        expect(mocks.seed).toHaveBeenCalledWith(7, 'brain-seed-7-https://acme.com')
        expect(mocks.named).toHaveBeenCalledWith({ workspaceId: 7, userId: 'user-1', overFirstName: true })
    })

    it('keeps the line of work they picked, and what they typed when the site says nothing', async () => {
        mocks.readAnswers.mockResolvedValue({ industry: 'legal', company_offering: 'Wedding planner' })
        await saveCompanySite(scope, { url: 'https://acme.com', profile: null, industry: null })
        expect(written()).toMatchObject({ industry: 'legal', company_offering: 'Wedding planner' })
    })

    it('goes on when the exploration cannot start', async () => {
        mocks.explore.mockRejectedValue(new Error('queue down'))
        await saveCompanySite(scope, { url: 'https://acme.com', profile: null, industry: null })
        expect(mocks.named).toHaveBeenCalled()
    })
})

describe('skipCompanySite', () => {
    it('remembers they have none without losing the rest', async () => {
        mocks.readAnswers.mockResolvedValue({ industry: 'legal', onboarding: { teamDone: true } })
        await skipCompanySite(scope)
        expect(written()).toEqual({ industry: 'legal', onboarding: { teamDone: true, siteSkipped: true } })
    })
})
