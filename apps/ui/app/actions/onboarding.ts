import type { WorkType } from '@/lib/onboarding/work-types'
import type { TemplateCategory } from '@rerun/contracts'

export type OnboardingAnswers = {
    company_url?: string
    company_name?: string
    company_description?: string
    company_offering?: string
    company_audience?: string
    industry?: TemplateCategory
    boxes?: string[]
    tools?: string[]
    skipped?: boolean
    work_type?: WorkType | 'other'
    work_type_other?: string
    sector?: TemplateCategory
    company_size?: string
    position?: string
    position_other?: string
}
