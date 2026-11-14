'use client'

import type { ReadonlyURLSearchParams } from 'next/navigation'

import { readHeroAgentApps, readHeroAgentName } from '@/lib/onboarding/hero-handoff'
import type { OnboardingState } from '@/stores/onboarding.store'
import type { KickoffIntent, PromptIntent } from './kickoff-marker'

function promptIntent(text: string, name: string | null | undefined, apps: string[] | undefined): PromptIntent {
    return { kind: 'prompt', text, ...(name ? { name } : {}), ...(apps?.length ? { apps } : {}) }
}

export function readArrivingIntent(searchParams: ReadonlyURLSearchParams, onboarding: OnboardingState): KickoffIntent | null {
    if (searchParams.has('purchase')) return null

    const slug = searchParams.get('template') ?? onboarding.pendingTemplateLink
    if (slug) return { kind: 'template', slug }

    const token = searchParams.get('share') ?? onboarding.pendingShareLink
    if (token) return { kind: 'share', token }

    const typed = searchParams.get('prompt')?.trim()
    if (typed) return promptIntent(typed, readHeroAgentName(searchParams), readHeroAgentApps(searchParams))

    const parked = onboarding.firstAgentFromPrompt ? onboarding.pendingFirstAgent : null
    return parked?.kickoff ? promptIntent(parked.kickoff, parked.name, parked.serviceSlugs) : null
}
