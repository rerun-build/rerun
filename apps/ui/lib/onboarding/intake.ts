import type { TemplateCategory } from '@rerun/contracts'

import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { DEFAULT_BOX_NAMES, divisionExamples } from '@/lib/onboarding/box-name-suggestions'

export { DEFAULT_ROLES, INDUSTRY_ROLES, INTAKE_INDUSTRIES, rolesForIndustry } from '@rerun/contracts'

// What the welcome card asks, and what it draws on the board while it asks it. Pure, so the lab can
// replay every industry without a network and the server can read the same lists back.

/** What the card hands over once its four steps are done. */
export type ForemanIntake = {
    companyUrl: string | null
    /** Picked by hand from the list. The only one of the three that is not a guess. */
    industry: TemplateCategory | null
    /**
     * What the fast decision made of their address while they were still answering, and therefore
     * what the board drew. Carried so a site the full read could not reach (no key, a crawler
     * blocked) still lands an industry rather than none: without it the foreman would be told the
     * company has no line of business while five of its divisions are on screen beside it.
     */
    decidedIndustry: TemplateCategory | null
    /** What they typed under "Other", when they named an industry we have no bucket for. */
    industryLabel: string | null
    position: string | null
    firstName: string | null
}

// Five is the ceiling rather than the count: `INDUSTRY_BOX_NAMES` is ordered most universal first,
// so cutting from the end drops the division someone is least likely to run.
const MAX_BOXES = 5

/** The divisions drawn on the board the moment the industry is known. Never empty. */
export function intakeBoxes(industry: string | null | undefined): string[] {
    return (divisionExamples(industry) ?? DEFAULT_BOX_NAMES).slice(0, MAX_BOXES)
}

/**
 * The same shape the foreman's own plan card hands the board, with no agent in any of it: the Boxes
 * trace themselves, and nothing pretends anyone has been hired yet. The title is dead weight here,
 * since the board no longer draws one, but it is what `ShownPlan` is, so it carries the company name.
 */
/**
 * The board of someone who arrived on a template or a shared coworker, before anything is built: the
 * default divisions, and what they came for already sitting in the first one.
 */
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
