import type { ForemanIntakeRequest } from './foreman.js'
import { TEMPLATE_CATEGORIES, type TemplateCategory } from './template-display.js'
import { TRIAL_ACTIVE_AGENTS } from './billing.js'

export const INTAKE_STEPS = ['industry', 'company', 'role', 'name'] as const

export type IntakeStep = (typeof INTAKE_STEPS)[number]

export type IntakeDraft = {
    companyUrl: string
    websiteSkipped: boolean
    industry: IntakeKind | null
    industryLabel: string
    position: string
    firstName: string
}

export const EMPTY_DRAFT: IntakeDraft = { companyUrl: '', websiteSkipped: false, industry: null, industryLabel: '', position: '', firstName: '' }

export const INTAKE_COPY: Record<IntakeStep, { title: string; description: string }> = {
    industry: { title: 'What kind of company are you building?', description: 'It decides which teams we put on your board.' },
    company: { title: 'What is your company website?', description: 'We read it to learn what you sell and who you sell to.' },
    role: { title: 'And what do you do there?', description: 'It decides who gets built for you first.' },
    name: { title: 'Last one: your first name?', description: 'So we are not talking to a workspace.' },
}

export function intakeSteps(knownFirstName: string | null | undefined): IntakeStep[] {
    return INTAKE_STEPS.filter(step => step !== 'name' || !knownFirstName?.trim())
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

export function toIntake(draft: IntakeDraft, knownFirstName: string | null | undefined, decided: TemplateCategory | null = null, boxes: string[] | null = null): ForemanIntakeRequest {
    const trim = (value: string) => value.trim() || null
    return {
        companyUrl: trim(draft.companyUrl),
        industry: draft.industry,
        decidedIndustry: decided,
        industryLabel: trim(draft.industryLabel),
        position: trim(draft.position),
        firstName: trim(draft.firstName) ?? (knownFirstName?.trim() || null),
        boxes,
    }
}

export function industryHint(draft: IntakeDraft): string | null {
    if (draft.industry) return null
    return draft.industryLabel.trim() || draft.companyUrl.trim() || null
}

export function isTemplateCategory(value: string): value is TemplateCategory {
    return (TEMPLATE_CATEGORIES as readonly string[]).includes(value)
}

export const SOFTWARE_STUDIO = 'studio'

export type IntakeKind = TemplateCategory | typeof SOFTWARE_STUDIO

export const INTAKE_KINDS = [...TEMPLATE_CATEGORIES, SOFTWARE_STUDIO] as const

export function isIntakeKind(value: string): value is IntakeKind {
    return value === SOFTWARE_STUDIO || isTemplateCategory(value)
}

export function kindCategory(kind: IntakeKind): TemplateCategory {
    return kind === SOFTWARE_STUDIO ? 'saas' : kind
}

export const INTAKE_INDUSTRIES: { value: IntakeKind }[] = [{ value: SOFTWARE_STUDIO }, ...TEMPLATE_CATEGORIES.filter(category => category !== 'other').map(category => ({ value: category }))]

export const INDUSTRY_ROLES: Record<IntakeKind, string[]> = {
    studio: ['Founder / Builder', 'Engineer or developer', 'Designer', 'Product or project lead'],
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
    if (!industry || !isIntakeKind(industry) || INDUSTRY_ROLES[industry].length === 0) return DEFAULT_ROLES
    return INDUSTRY_ROLES[industry]
}

const SITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/.*)?$/i

export function looksLikeSite(input: string): boolean {
    return SITE.test(input.trim())
}

export const MAX_STARTER_PICKS = TRIAL_ACTIVE_AGENTS
