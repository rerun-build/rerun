import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'

import { checkoutCopy, type BillingTranslator, type CheckoutContext } from './checkout-copy'

const t = createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace: 'billing' }) as unknown as BillingTranslator

const context: CheckoutContext = {
    billed: '$29/mo',
    nextInvoice: 'Dec 9',
    trialEnds: 'Nov 12',
    trialDaysLeft: 3,
    reminderOn: null,
    firstCharge: '$29',
    trialCancelled: false,
    keptUntil: null,
    parked: null,
    coworker: null,
}

describe('checkoutCopy credit_locked', () => {
    it('names the coworker that stopped and prices the pay button', () => {
        const copy = checkoutCopy(t, 'credit_locked', { ...context, coworker: 'Maya' })
        expect(copy.title).toBe('Keep going with Pro')
        expect(copy.subtitle).toBe('Maya picks up where it stopped.')
        expect(copy.payCta?.('$35.09')).toBe('Pay $35.09 & resume')
    })

    it('keeps the plain wording when no coworker opened it', () => {
        const copy = checkoutCopy(t, 'credit_locked', context)
        expect(copy.title).toBe('Rerun credits come with Pro')
        expect(copy.cta).toBe('End trial & subscribe')
        expect(copy.payCta).toBeUndefined()
    })

    it('says a refused payment left the trial as it was, once', () => {
        const { refusal } = checkoutCopy(t, 'credit_locked', context)
        expect(refusal?.('Your card was declined.')).toBe('Your card was declined. Nothing was charged and your trial is unchanged.')
        expect(refusal?.("We couldn't charge your card. Nothing was charged, try again or change your card.")).toBe("We couldn't charge your card. Nothing was charged, try again or change your card. Your trial is unchanged.")
    })
})
