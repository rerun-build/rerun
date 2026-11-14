import type { ForemanIntakeRequest } from './foreman.js'
import { TEMPLATE_CATEGORIES, type TemplateCategory } from './template-display.js'
import { TRIAL_ACTIVE_AGENTS } from './billing.js'

export const INTAKE_STEPS = ['company', 'industry', 'role', 'name'] as const

export type IntakeStep = (typeof INTAKE_STEPS)[number]

export type IntakeDraft = {
    companyUrl: string
    websiteSkipped: boolean
    industry: TemplateCategory | null
    industryLabel: string
    position: string
    firstName: string
}

export const EMPTY_DRAFT: IntakeDraft = { companyUrl: '', websiteSkipped: false, industry: null, industryLabel: '', position: '', firstName: '' }

export const INTAKE_COPY: Record<IntakeStep, { title: string; description: string }> = {
    company: { title: 'What is your company website?', description: 'We read it to learn what you sell and who you sell to.' },
    industry: { title: 'What line of work are you in?', description: 'It decides which teams we draw on your board.' },
    role: { title: 'And what do you do there?', description: 'It decides who gets built for you first.' },
    name: { title: 'Last one: your first name?', description: 'So we are not talking to a workspace.' },
}

export function intakeSteps(knownFirstName: string | null | undefined, websiteSkipped = false): IntakeStep[] {
    return INTAKE_STEPS.filter(step => {
        if (step === 'industry') return websiteSkipped
        if (step === 'name') return !knownFirstName?.trim()
        return true
    })
}

export function stepAnswered(step: IntakeStep, draft: IntakeDraft): boolean {
    if (step === 'company') return !!draft.companyUrl.trim() || draft.websiteSkipped
    if (step === 'industry') return !!draft.industry || !!draft.industryLabel.trim()
    if (step === 'role') return !!draft.position.trim()
    return !!draft.firstName.trim()
}

export function furthestReachable(steps: IntakeStep[], draft: IntakeDraft): number {
    const firstUnanswered = steps.findIndex(step => !stepAnswered(step, draft))
    return firstUnanswered === -1 ? steps.length - 1 : firstUnanswered
}

export function toIntake(draft: IntakeDraft, knownFirstName: string | null | undefined, decided: TemplateCategory | null = null): ForemanIntakeRequest {
    const trim = (value: string) => value.trim() || null
    return {
        companyUrl: trim(draft.companyUrl),
        industry: draft.industry,
        decidedIndustry: decided,
        industryLabel: trim(draft.industryLabel),
        position: trim(draft.position),
        firstName: trim(draft.firstName) ?? (knownFirstName?.trim() || null),
    }
}

export function industryHint(draft: IntakeDraft): string | null {
    return draft.companyUrl.trim() || draft.industryLabel.trim() || null
}

export function isTemplateCategory(value: string): value is TemplateCategory {
    return (TEMPLATE_CATEGORIES as readonly string[]).includes(value)
}

export const INTAKE_INDUSTRIES = TEMPLATE_CATEGORIES.filter(category => category !== 'other').map(category => ({ value: category }))

export const INDUSTRY_ROLES: Record<TemplateCategory, string[]> = {
    agencies: ['Founder / Agency owner', 'Account or client lead', 'Marketing / Creative', 'Operations'],
    ecommerce: ['Founder / Store owner', 'Marketing / Growth', 'Customer care', 'Operations / Logistics'],
    saas: ['Founder / CEO', 'Product or Engineering', 'Marketing / Growth', 'Sales or Support'],
    sales: ['Founder / CEO', 'Sales rep or AE', 'Sales leadership', 'Marketing / Demand gen'],
    recruiting: ['Founder / Agency owner', 'Recruiter', 'Talent or HR lead', 'Operations'],
    'real-estate': ['Founder / Broker', 'Agent', 'Property or portfolio manager', 'Marketing'],
    legal: ['Founder / Partner', 'Lawyer or counsel', 'Paralegal or legal ops', 'Business development'],
    creators: ['Creator / Founder', 'Editor or writer', 'Community or social', 'Sponsorships / Business'],
    productivity: ['Founder / CEO', 'Operations', 'Finance or Admin', 'Project or team lead'],
    other: [],
}

export const DEFAULT_ROLES = ['Founder / CEO', 'Marketing', 'Sales', 'Operations']

export function rolesForIndustry(industry: string | null | undefined): string[] {
    if (!industry || !isTemplateCategory(industry) || INDUSTRY_ROLES[industry].length === 0) return DEFAULT_ROLES
    return INDUSTRY_ROLES[industry]
}

const SITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/.*)?$/i

export function looksLikeSite(input: string): boolean {
    return SITE.test(input.trim())
}

export const MAX_STARTER_PICKS = TRIAL_ACTIVE_AGENTS
