import { kindCategory, type IntakeKind, type TemplateCategory } from '@rerun/contracts'

import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { DEFAULT_BOX_NAMES, divisionExamples } from '@/lib/onboarding/box-name-suggestions'

export { DEFAULT_ROLES, INDUSTRY_ROLES, INTAKE_INDUSTRIES, looksLikeSite, rolesForIndustry } from '@rerun/contracts'

export type ForemanIntake = {
    companyUrl: string | null
    industry: IntakeKind | null
    decidedIndustry: TemplateCategory | null
    industryLabel: string | null
    position: string | null
    firstName: string | null
    boxes?: string[] | null
}

const MAX_BOXES = 5

export function intakeBoxes(industry: string | null | undefined, own?: string[] | null): string[] {
    return (own?.length ? own : (divisionExamples(industry) ?? DEFAULT_BOX_NAMES)).slice(0, MAX_BOXES)
}

export function intakeIndustry(intake: Pick<ForemanIntake, 'industry' | 'decidedIndustry' | 'industryLabel'>, read: TemplateCategory | null | undefined): TemplateCategory | null {
    if (intake.industry) return kindCategory(intake.industry)
    return (intake.industryLabel ? (intake.decidedIndustry ?? read) : (read ?? intake.decidedIndustry)) ?? null
}

export function boxesOfIntake(intake: Pick<ForemanIntake, 'industry' | 'decidedIndustry' | 'industryLabel' | 'boxes'>): string[] {
    if (!intake.industry && intake.industryLabel?.trim()) return intakeBoxes(null, intake.boxes)
    return intakeBoxes(intake.industry ?? intake.decidedIndustry, intake.boxes)
}

const TEAM_NAME = /^[\p{L}\p{N}][\p{L}\p{N}&' -]*$/u
const TEAM_NAME_MAX = 24
const TEAM_WORDS_MAX = 3
const MIN_TEAMS = 4
const MAX_TEAMS = 6

export function clampBoxNames(names: unknown): string[] | null {
    if (!Array.isArray(names)) return null
    const clean = names
        .map(name => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''))
        .filter(name => name.length > 0 && name.length <= TEAM_NAME_MAX && name.split(' ').length <= TEAM_WORDS_MAX && TEAM_NAME.test(name))
    const unique = clean.filter((name, index) => clean.findIndex(other => other.toLowerCase() === name.toLowerCase()) === index).slice(0, MAX_TEAMS)
    return unique.length >= MIN_TEAMS ? unique : null
}

export function arrivalPreviewPlan(title: string): ShownPlan {
    return {
        title: 'Your company',
        groups: intakeBoxes(null).map((name, index) => ({ key: `arrival-${index}-${name}`, name, role: '', items: index === 0 ? [{ key: 'arrival', name: title, role: '', when: '' }] : [] })),
    }
}

export function intakePreviewPlan(industry: string | null | undefined, own?: string[] | null, companyName?: string | null): ShownPlan {
    return {
        title: companyName?.trim() || 'Your company',
        groups: intakeBoxes(industry, own).map((name, index) => ({ key: `intake-${index}-${name}`, name, role: '', items: [] })),
    }
}
