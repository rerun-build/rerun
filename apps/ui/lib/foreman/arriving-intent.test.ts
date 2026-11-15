import type { ReadonlyURLSearchParams } from 'next/navigation'
import { describe, expect, it } from 'vitest'

import type { OnboardingState } from '@/stores/onboarding.store'
import { readArrivingIntent } from './arriving-intent'

const query = (search: string) => new URLSearchParams(search) as unknown as ReadonlyURLSearchParams

function parked(state: Partial<OnboardingState> = {}): OnboardingState {
    return { pendingFirstAgent: null, pendingTemplateLink: null, pendingShareLink: null, firstAgentFromPrompt: false, ...state } as OnboardingState
}

const DRAFT = { name: 'Lead Finder', serviceSlugs: ['hubspot'], kickoff: 'Find me leads every Monday' }

describe('readArrivingIntent', () => {
    it('reads the prompt of the landing composer with the name and the apps it read', () => {
        expect(readArrivingIntent(query('prompt=Find+me+leads&name=Lead+Finder&apps=hubspot,gmail'), parked())).toEqual({ kind: 'prompt', text: 'Find me leads', name: 'Lead Finder', apps: ['hubspot', 'gmail'] })
    })

    it('reads a bare prompt as before', () => {
        expect(readArrivingIntent(query('prompt=Find+me+leads'), parked())).toEqual({ kind: 'prompt', text: 'Find me leads' })
    })

    it('reads the parked draft once the query string is gone', () => {
        expect(readArrivingIntent(query(''), parked({ pendingFirstAgent: DRAFT, firstAgentFromPrompt: true }))).toEqual({ kind: 'prompt', text: 'Find me leads every Monday', name: 'Lead Finder', apps: ['hubspot'] })
    })

    it('leaves alone a draft the landing composer did not park', () => {
        expect(readArrivingIntent(query(''), parked({ pendingFirstAgent: DRAFT }))).toBeNull()
    })

    it('puts a template link before a prompt', () => {
        expect(readArrivingIntent(query('template=seo-newsroom&prompt=x'), parked())).toEqual({ kind: 'template', slug: 'seo-newsroom' })
    })
})
