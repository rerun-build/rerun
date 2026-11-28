import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SubscriptionState } from '@/ee/services/billing.service'

import { PlanPanel } from './PlanPanel'
import type { TilesData } from './views'

vi.mock('@/ee/actions/billing.actions', () => ({ cancelPendingSwitchAction: vi.fn() }))
vi.mock('@/ee/lib/billing/plan-payment', () => ({ runPlanChange: vi.fn() }))
vi.mock('../usePlanQuote', () => ({ usePlanQuote: () => null }))

const ACTIVE: SubscriptionState = {
    entitled: true,
    status: 'active',
    quantities: { linkedin_slot: 0, whatsapp_slot: 0, storage_pack: 0 },
    interval: 'monthly',
    machineSize: 'small',
    machine: null,
    heldMachine: { machineSize: 'small', storagePacks: 0 },
    pendingSwitch: null,
    monthlyDiscountCents: 0,
    pendingDowngrade: {},
    periodEnd: '2026-12-27T18:17:53Z',
    card: { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030 },
    nextInvoice: { at: '2026-12-27T18:17:53Z', amountCents: 2900 },
    openInvoice: null,
    hasPaymentMethod: true,
    cancelAtPeriodEnd: false,
    cancelPhase: 'paid',
    retentionOffer: null,
    business: { name: null, country: null, taxId: null },
}

const DATA: TilesData = {
    credit: { status: 'loading' } as unknown as TilesData['credit'],
    invoices: [],
    referrals: { overview: null, failed: false },
    apps: [],
    appSlots: {},
    trialEndsAt: null,
    trialDaysLeft: null,
}

function managePlan(state: SubscriptionState): string {
    return renderToStaticMarkup(createElement(PlanPanel, { state, data: DATA, go: () => {}, onBack: () => {}, onDone: () => {} }))
}

const cancelButton = />Cancel plan<\/button>/

// RER-425: on a phone the only way to cancel was a small link at the very end of the Billing home, and the
// page a subscriber opens to manage the plan offered none.
describe('PlanPanel', () => {
    it('offers to cancel a paid plan from the Manage plan page', () => {
        expect(managePlan(ACTIVE)).toMatch(cancelButton)
    })

    it('offers nothing to cancel once the cancellation is requested', () => {
        expect(managePlan({ ...ACTIVE, cancelAtPeriodEnd: true, nextInvoice: null })).not.toMatch(cancelButton)
    })

    it('offers nothing to cancel on a subscription with no cancel flow', () => {
        expect(managePlan({ ...ACTIVE, cancelPhase: null })).not.toMatch(cancelButton)
    })

    it('offers nothing labelled Cancel plan during a trial, which the Billing home cancels as a trial', () => {
        expect(managePlan({ ...ACTIVE, status: 'trialing', cancelPhase: 'trial' })).not.toMatch(cancelButton)
    })
})
