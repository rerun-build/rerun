import type { WorkType } from '@/lib/onboarding/work-types'
import type { TemplateCategory } from '@rerun/contracts'

// The shape of `workspace_onboarding.answers`, written by the foreman's save_profile and read by the
// naming service, the lifecycle emails and the template recommender.
//
// Every field is optional, and the ones nothing asks any more are still declared: rows written
// before it was recalibrated carry a `use_case` pivot that no longer exists, then an industry and a
// role the two-step version dropped, then the work type the website question replaced. Reading one
// back must not claim fields it never had.
export type OnboardingAnswers = {
    // What the company website step read off the site, when it was given and could be read.
    company_url?: string
    company_name?: string
    company_description?: string
    company_offering?: string
    company_audience?: string
    industry?: TemplateCategory
    // Service slugs, in the order they were picked.
    tools?: string[]
    // Answered "later" rather than answered: kept so the survey never asks twice, and so the
    // funnel can tell an empty profile apart from a deliberate pass.
    skipped?: boolean
    // Written by earlier versions of the survey, still read for users who onboarded back then.
    work_type?: WorkType | 'other'
    work_type_other?: string
    sector?: TemplateCategory
    company_size?: string
    position?: string
    position_other?: string
    // What the welcome page keeps besides the fields above, which every other reader already knows.
    onboarding?: WelcomeProgress
}

export type WelcomeProgress = {
    siteSkipped?: boolean
    // What the read of the site filed it under: the industry question opens on it.
    siteIndustry?: TemplateCategory
    // What they typed under "Other", kept verbatim beside the bucket it was filed into.
    industryLabel?: string
    teamDone?: boolean
    // Set when the onboarding hands over, cleared by the one turn in which the Chief of Staff speaks first.
    greetPending?: boolean
}
