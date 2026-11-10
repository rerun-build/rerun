'use client'

import { boxNameSuggestions } from '@/lib/onboarding/box-name-suggestions'
import { useOnboardingIndustry } from '@/lib/onboarding/useOnboardingIndustry'
import { useBoardStore } from '@/stores/board.store'
import { useTranslations } from 'next-intl'

// "Customer Care" is read as the key `customerCare`.
const nameKey = (name: string) => name.split(' ').map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join('')

// The names offered under the Box name field: the industry read off the user's website, minus the
// Boxes the workspace already has. Both sources are already in memory, so this costs no fetch.
export function useBoxNameSuggestions(): string[] {
    const t = useTranslations('dialogs.newBox.suggestedNames')
    const industry = useOnboardingIndustry()
    const spaces = useBoardStore(s => s.spaces)
    const taken = spaces.map(space => space.name ?? '')

    return boxNameSuggestions(industry, taken, name => (t.has(nameKey(name) as never) ? t(nameKey(name) as never) : name))
}
