import { toAgentSuggestion, type StoredIdea } from '@/lib/agent-ideas/stored'
import type { Lens } from '@/lib/agent-ideas/types'
import { isTemplateCategory } from '@/lib/onboarding/industries'

import { agentSuggestionsForIndustry, DEFAULT_AGENT_SUGGESTIONS, INDUSTRY_AGENT_SUGGESTIONS, type AgentSuggestion } from './agent-suggestions'

// What a Box is for, read off its name: a Box has nothing else to say it, and the names people give
// one are the divisions the name picker offers (`box-name-suggestions.ts`) or close to them.
export const BOX_THEMES = ['marketing', 'sales', 'support', 'operations', 'finance', 'product', 'clients', 'recruiting', 'legal', 'personal'] as const
export type BoxTheme = (typeof BOX_THEMES)[number]

// Whole words of a Box name, the longest first so "new business" wins over a word inside it. A name
// that says what the company sells rather than a division ("Store", "Listings", the company's own
// name) is left without a theme on purpose: the industry list already is the right answer for it.
const THEME_WORDS: [string, BoxTheme][] = [
    ['customer care', 'support'],
    ['customer service', 'support'],
    ['customer success', 'support'],
    ['new business', 'sales'],
    ['business development', 'sales'],
    ['supply chain', 'operations'],
    ['marketing', 'marketing'],
    ['growth', 'marketing'],
    ['content', 'marketing'],
    ['community', 'marketing'],
    ['social', 'marketing'],
    ['seo', 'marketing'],
    ['brand', 'marketing'],
    ['sales', 'sales'],
    ['outbound', 'sales'],
    ['leads', 'sales'],
    ['sponsors', 'sales'],
    ['ventes', 'sales'],
    ['commercial', 'sales'],
    ['support', 'support'],
    ['helpdesk', 'support'],
    ['ops', 'operations'],
    ['operations', 'operations'],
    ['admin', 'operations'],
    ['logistics', 'operations'],
    ['projects', 'operations'],
    ['finance', 'finance'],
    ['finances', 'finance'],
    ['accounting', 'finance'],
    ['billing', 'finance'],
    ['compta', 'finance'],
    ['comptabilite', 'finance'],
    ['product', 'product'],
    ['produit', 'product'],
    ['engineering', 'product'],
    ['tech', 'product'],
    ['dev', 'product'],
    ['clients', 'clients'],
    ['accounts', 'clients'],
    ['recruiting', 'recruiting'],
    ['recrutement', 'recruiting'],
    ['hiring', 'recruiting'],
    ['talent', 'recruiting'],
    ['people', 'recruiting'],
    ['hr', 'recruiting'],
    ['rh', 'recruiting'],
    ['legal', 'legal'],
    ['compliance', 'legal'],
    ['juridique', 'legal'],
    ['personal', 'personal'],
    ['perso', 'personal'],
]

function words(name: string): string {
    const flat = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    return ` ${flat} `
}

export function boxTheme(name: string | null | undefined): BoxTheme | null {
    if (!name) return null
    const padded = words(name)
    return THEME_WORDS.find(([word]) => padded.includes(` ${word} `))?.[1] ?? null
}

// The functions of the made-to-measure ideas (`Lens`) that belong in a Box of each theme.
export const THEME_LENSES: Record<BoxTheme, Lens[]> = {
    marketing: ['acquisition', 'content', 'watch'],
    sales: ['sales', 'acquisition'],
    support: ['support'],
    operations: ['delivery', 'backoffice'],
    finance: ['backoffice'],
    product: ['delivery', 'watch'],
    clients: ['delivery', 'support'],
    recruiting: ['delivery', 'backoffice'],
    legal: ['backoffice', 'watch'],
    personal: [],
}

// The few jobs no industry list carries, for the themes that would otherwise run short.
const EXTRA_SUGGESTIONS: AgentSuggestion[] = [
    {
        id: 'support-help-center',
        title: 'Keep my help center up to date',
        description: 'The questions that keep coming back, turned into articles.',
        name: 'Help Center Writer',
        kickoff: 'Help me keep my help center up to date. Ask me where support questions arrive, then tell me each week which ones keep coming back and draft the article that answers each of them.',
        apps: ['intercom', 'notion'],
    },
    {
        id: 'support-escalations',
        title: 'Flag the unhappy customers',
        description: 'Who is upset today, why, and what to tell them.',
        name: 'Escalation Watch',
        kickoff: 'Watch my support inbox for unhappy customers. Every morning, tell me who is upset and why, and draft what I should answer to each of them.',
        apps: ['gmail', 'slack'],
    },
    {
        id: 'finance-expenses',
        title: 'Sort my receipts',
        description: 'Every receipt filed, with what is missing.',
        name: 'Receipt Sorter',
        kickoff: 'Help me keep my receipts in order. Ask me where they arrive, then file each one in my spreadsheet with its amount, date and category, and tell me which ones are missing at the end of the month.',
        apps: ['gmail', 'google-sheets'],
    },
    {
        id: 'finance-cash-brief',
        title: 'Brief me on my cash every week',
        description: 'What came in, what went out, what is due.',
        name: 'Cash Brief',
        kickoff: 'Every Monday, tell me where my cash stands: what came in last week, what went out, and which payments are due in the next two.',
        apps: ['stripe', 'google-sheets'],
    },
    {
        id: 'finance-failed-payments',
        title: 'Recover my failed payments',
        description: 'Each failed charge, with the email to win it back.',
        name: 'Payment Recovery',
        kickoff: 'Help me recover failed payments. Every morning, list the charges that failed yesterday and draft the email I should send to each customer.',
        apps: ['stripe', 'gmail'],
    },
]

// Ids from the industry lists, the default list and the extras above, the most universal first.
const THEME_SUGGESTION_IDS: Record<BoxTheme, string[]> = {
    marketing: ['default-seo', 'default-content', 'ecommerce-newsletter', 'creators-content-calendar', 'ecommerce-ads', 'creators-repurpose', 'agencies-case-studies', 'creators-analytics', 'creators-scheduler', 'real-estate-social'],
    sales: ['sales-prospect-research', 'sales-follow-ups', 'sales-outreach', 'sales-crm-hygiene', 'sales-reply-sorter', 'sales-lead-responder', 'sales-call-notes', 'sales-pipeline', 'agencies-proposal'],
    support: ['saas-support', 'ecommerce-reviews', 'support-help-center', 'support-escalations', 'saas-churn', 'saas-issue-triage', 'creators-comments', 'legal-intake'],
    operations: ['default-meeting-notes', 'default-weekly-report', 'default-follow-ups', 'productivity-docs', 'default-daily-brief', 'ecommerce-stock', 'recruiting-scheduling', 'legal-deadlines'],
    finance: ['agencies-invoices', 'finance-cash-brief', 'finance-expenses', 'finance-failed-payments', 'ecommerce-sales-report', 'saas-metrics', 'legal-time-entries', 'default-weekly-report'],
    product: ['saas-changelog', 'saas-issue-triage', 'saas-errors', 'saas-metrics', 'saas-churn', 'saas-onboarding-emails', 'default-research', 'productivity-docs'],
    clients: ['agencies-client-report', 'agencies-meeting-notes', 'real-estate-nurture', 'legal-intake', 'recruiting-updates', 'agencies-invoices', 'default-follow-ups', 'agencies-proposal'],
    recruiting: INDUSTRY_AGENT_SUGGESTIONS.recruiting.map(suggestion => suggestion.id),
    legal: INDUSTRY_AGENT_SUGGESTIONS.legal.map(suggestion => suggestion.id),
    personal: INDUSTRY_AGENT_SUGGESTIONS.productivity.map(suggestion => suggestion.id),
}

const SUGGESTIONS_BY_ID = new Map([...Object.values(INDUSTRY_AGENT_SUGGESTIONS).flat(), ...DEFAULT_AGENT_SUGGESTIONS, ...EXTRA_SUGGESTIONS].map(suggestion => [suggestion.id, suggestion]))

export function themeSuggestions(theme: BoxTheme): AgentSuggestion[] {
    return THEME_SUGGESTION_IDS[theme].flatMap(id => SUGGESTIONS_BY_ID.get(id) ?? [])
}


const nameKey = (name: string) => name.trim().toLowerCase()

// The made-to-measure ideas that belong in this Box, minus the ones already recruited: an idea is
// imagined once, and the agent created from it keeps its name.
export function boxIdeas(boxName: string | null | undefined, ideas: StoredIdea[], agentNames: string[]): StoredIdea[] {
    const theme = boxTheme(boxName)
    const recruited = new Set(agentNames.map(nameKey))
    return ideas.filter(idea => !recruited.has(nameKey(idea.name)) && (!theme || THEME_LENSES[theme].includes(idea.lens)))
}

// The pill is one unbroken line across the Box, in whatever language it is written.
const CTA_MAX_CHARS = 34

// The `builder.isoBoard` catalog.
export type BoxCtaCopy = (key: 'boxCta' | 'boxCtaFallback', values?: Record<string, string>) => string

// What the pill of an empty Box says once hovered: what the click opens, in the Box's own name.
export function boxCtaLabel(boxName: string | null | undefined, t: BoxCtaCopy): string {
    const name = boxName?.trim()
    const named = name ? t('boxCta', { name }) : null
    return named && named.length <= CTA_MAX_CHARS ? named : t('boxCtaFallback')
}

const CTA_EXAMPLE_MAX_CHARS = 28
const MAX_CTA_EXAMPLES = 5

// What the pill of an empty Box rolls through while nobody hovers it: the first titles the dialog
// will open on, so the pill never promises a job the click does not show.
export function boxCtaExamples(input: Parameters<typeof boxSuggestions>[0], localize: (suggestion: AgentSuggestion) => AgentSuggestion = suggestion => suggestion): string[] {
    return boxSuggestions(input)
        .map(suggestion => localize(suggestion).title)
        .filter(title => title.length <= CTA_EXAMPLE_MAX_CHARS)
        .slice(0, MAX_CTA_EXAMPLES)
}

// What the New agent dialog offers when it is opened for one Box. The ideas imagined for the company
// lead, since they are the only ones true of nobody else. Then the jobs of the Box's theme, the ones
// written for this industry first, then the industry's own list.
//
// The whole pool comes back, in that order, not just the three cards the dialog draws: Reload
// slides on through the rest, and what never fits on the first screen is what a Box whose own ideas
// already took the places falls back on. `boxName` is null when the dialog was opened from the
// toolbar, for no Box in particular.
export function boxSuggestions({ boxName, industry, ideas, agentNames }: { boxName: string | null | undefined; industry: string | null | undefined; ideas: StoredIdea[]; agentNames: string[] }): AgentSuggestion[] {
    const theme = boxTheme(boxName)
    const ofIndustry = agentSuggestionsForIndustry(industry)
    const ownIds = new Set(industry && isTemplateCategory(industry) ? INDUSTRY_AGENT_SUGGESTIONS[industry].map(suggestion => suggestion.id) : [])
    const ofTheme = theme ? themeSuggestions(theme) : []
    const themed = [...ofTheme.filter(suggestion => ownIds.has(suggestion.id)), ...ofTheme.filter(suggestion => !ownIds.has(suggestion.id))]

    const ids = new Set<string>()
    const names = new Set<string>()
    const picked: AgentSuggestion[] = []
    for (const suggestion of [...boxIdeas(boxName, ideas, agentNames).map(toAgentSuggestion), ...themed, ...ofIndustry]) {
        if (ids.has(suggestion.id) || names.has(nameKey(suggestion.name))) continue
        ids.add(suggestion.id)
        names.add(nameKey(suggestion.name))
        picked.push(suggestion)
    }
    return picked
}
