import type { TemplateCategory } from '@rerun/contracts'

import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { DEFAULT_BOX_NAMES, divisionExamples } from '@/lib/onboarding/box-name-suggestions'

export { DEFAULT_ROLES, INDUSTRY_ROLES, INTAKE_INDUSTRIES, looksLikeSite, rolesForIndustry } from '@rerun/contracts'

export type ForemanIntake = {
    companyUrl: string | null
    industry: TemplateCategory | null
    decidedIndustry: TemplateCategory | null
    industryLabel: string | null
    position: string | null
    firstName: string | null
}

const MAX_BOXES = 5

export function intakeBoxes(industry: string | null | undefined): string[] {
    return (divisionExamples(industry) ?? DEFAULT_BOX_NAMES).slice(0, MAX_BOXES)
}

export function arrivalPreviewPlan(title: string): ShownPlan {
    return {
        title: 'Your company',
        groups: intakeBoxes(null).map((name, index) => ({ key: `arrival-${index}-${name}`, name, role: '', items: index === 0 ? [{ key: 'arrival', name: title, role: '', when: '' }] : [] })),
    }
}

export function intakePreviewPlan(industry: string | null | undefined, companyName?: string | null): ShownPlan {
    return {
        title: companyName?.trim() || 'Your company',
        groups: intakeBoxes(industry).map((name, index) => ({ key: `intake-${index}-${name}`, name, role: '', items: [] })),
    }
}
