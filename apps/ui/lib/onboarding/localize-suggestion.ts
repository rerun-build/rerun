import type { useTranslations } from 'next-intl'

import type { AgentSuggestion } from './agent-suggestions'

export type SuggestionTranslator = ReturnType<typeof useTranslations<'agentSuggestions'>>
type SuggestionKey = Parameters<SuggestionTranslator>[0]

// The written suggestions carry their English; the pack holds them by id. An idea imagined for the
// company has no entry and stays as it was written.
export function localizeSuggestion(suggestion: AgentSuggestion, t: SuggestionTranslator): AgentSuggestion {
    const key = (field: 'title' | 'description' | 'name' | 'kickoff') => `${suggestion.id}.${field}` as SuggestionKey
    if (!t.has(key('title'))) return suggestion
    return { ...suggestion, title: t(key('title')), description: t(key('description')), name: t(key('name')), kickoff: t(key('kickoff')) }
}
