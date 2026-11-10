'use client'

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { useAgentIdeas } from '@/lib/agent-ideas/useAgentIdeas'
import type { AgentSuggestion } from '@/lib/onboarding/agent-suggestions'
import { boxSuggestions, boxTheme } from '@/lib/onboarding/box-themes'
import { localizeSuggestion } from '@/lib/onboarding/localize-suggestion'
import { useOnboardingIndustry } from '@/lib/onboarding/useOnboardingIndustry'
import { useBoardStore } from '@/stores/board.store'

// What the New agent dialog offers for the Box it was opened from, and the line that introduces it.
// With no Box (the toolbar button) it is the company's ideas, then its industry's.
export function useBoxAgentSuggestions(spaceId: string | null, open: boolean): { suggestions: AgentSuggestion[]; heading: string | undefined } {
    const industry = useOnboardingIndustry()
    const ideas = useAgentIdeas(open)
    const boxName = useBoardStore(s => (spaceId ? (s.spaces.find(space => space.id === spaceId)?.name ?? null) : null))
    const agents = useBoardStore(s => s.agents)
    const t = useTranslations('dialogs.newAgent')
    const tSuggestions = useTranslations('agentSuggestions')

    return useMemo(() => {
        const suggestions = boxSuggestions({ boxName, industry, ideas, agentNames: agents.map(agent => agent.name) }).map(suggestion => localizeSuggestion(suggestion, tSuggestions))
        return { suggestions, heading: boxName && boxTheme(boxName) ? t('suggestionsForBox', { boxName }) : undefined }
    }, [boxName, industry, ideas, agents, t, tSuggestions])
}
