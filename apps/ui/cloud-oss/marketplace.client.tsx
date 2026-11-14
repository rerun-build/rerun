'use client'

import type { CreatorPane } from '@/stores/creator.store'

type CreatorAccountState = { state: 'not_started' | 'incomplete' | 'pending_verification' | 'restricted' | 'ready'; stripeAccountId: string | null; chargesEnabled: boolean }

export async function startTemplateCheckoutAction(_slug: string): Promise<{ ok: true; outcome: { kind: 'checkout'; url: string } | { kind: 'owned' } | { kind: 'free' } } | { ok: false; error: string; needsPlan?: true }> {
    return { ok: true, outcome: { kind: 'free' } }
}

export async function confirmTemplatePurchaseAction(_sessionId: string): Promise<{ ok: true; entitled: boolean } | { ok: false; error: string }> {
    return { ok: true, entitled: true }
}

export function TemplatePricingSection() {
    return null
}

export function CreatorPayoutsPanel(_props: { active: boolean }) {
    return null
}

export function CreatorRevenuePanel(_props: { active: boolean }) {
    return null
}

export function CreatorSidebarFooter(_props: { pane: CreatorPane; account: CreatorAccountState | null; onSelect: (pane: CreatorPane) => void }) {
    return null
}

export function useCreatorPayouts(_active: boolean): { account: CreatorAccountState | null } {
    return { account: null }
}
