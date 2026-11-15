import type { OnboardingAnswers } from '@/app/actions/onboarding'
import { asTitle } from '@/lib/naming/workspace-name'
import { boxNameSuggestions, DEFAULT_BOX_NAMES } from '@/lib/onboarding/box-name-suggestions'
import { workTypeTemplateCategory } from '@/lib/onboarding/work-types'

const MAX_LENGTH = 60

export function industryFromAnswers(answers: unknown): string | null {
    const stored = answers as OnboardingAnswers | null | undefined
    return stored?.industry ?? workTypeTemplateCategory(stored?.work_type) ?? stored?.sector ?? null
}

export function firstBoxName(industry: string | null | undefined, taken: string[]): string {
    return boxNameSuggestions(industry, taken)[0] ?? DEFAULT_BOX_NAMES[0]
}

export function boxNameFrom(input: { companyName?: string | null; firstName?: string | null; industry?: string | null; taken: string[] }): string {
    const name = input.companyName?.trim() || asTitle(input.firstName ?? '')
    if (name) return name.length > MAX_LENGTH ? name.slice(0, MAX_LENGTH).trimEnd() : name
    return firstBoxName(input.industry, input.taken)
}

export function companyNameFromAnswers(answers: unknown): string | null {
    return (answers as OnboardingAnswers | null | undefined)?.company_name?.trim() || null
}
