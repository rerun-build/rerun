import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { CREDIT_PURCHASE_KIND, invoiceItemsOf } from './invoice-items'

const prices = {
    isBasePriceId: (priceId: string) => priceId === 'price_base',
    addonForPriceId: (priceId: string) => (priceId === 'price_linkedin' ? ('linkedin_slot' as const) : priceId === 'price_whatsapp' ? ('whatsapp_slot' as const) : priceId === 'price_storage' ? ('storage_pack' as const) : undefined),
    machineSizeForPriceId: (priceId: string) => (priceId === 'price_machine_large' ? ('large' as const) : undefined),
}

function line(price: string, amount: number, { quantity = 1, proration = false } = {}): Stripe.InvoiceLineItem {
    return { amount, quantity, pricing: { price_details: { price } }, parent: { subscription_item_details: { proration } } } as unknown as Stripe.InvoiceLineItem
}

function invoice(lines: Stripe.InvoiceLineItem[], metadata: Record<string, string> = {}) {
    return { metadata, lines: { data: lines } } as unknown as Pick<Stripe.Invoice, 'metadata' | 'lines'>
}

describe('invoiceItemsOf', () => {
    it('names the plan first, then each app with its slots', () => {
        expect(invoiceItemsOf(invoice([line('price_linkedin', 900, { quantity: 2 }), line('price_base', 2900)]), prices)).toEqual({
            items: [{ kind: 'plan' }, { kind: 'app', app: 'linkedin', quantity: 2 }],
            prorated: false,
        })
    })

    it('names the machine size and the storage packs beside the plan', () => {
        expect(invoiceItemsOf(invoice([line('price_base', 2900), line('price_machine_large', 7000), line('price_storage', 1000, { quantity: 2 }), line('price_storage', 1000)]), prices)).toEqual({
            items: [{ kind: 'plan' }, { kind: 'machine', size: 'large' }, { kind: 'storage', quantity: 3 }],
            prorated: false,
        })
    })

    it('reads a credit purchase from its metadata', () => {
        expect(invoiceItemsOf(invoice([], { kind: CREDIT_PURCHASE_KIND, packs: '3' }), prices)).toEqual({ items: [{ kind: 'credit_pack', quantity: 3 }], prorated: false })
    })

    it('marks an invoice that only carries prorations', () => {
        expect(invoiceItemsOf(invoice([line('price_whatsapp', 630, { proration: true }), line('price_whatsapp', -100, { proration: true })]), prices)).toEqual({
            items: [{ kind: 'app', app: 'whatsapp', quantity: 1 }],
            prorated: true,
        })
    })

    it('leaves out the credit lines of a switch and the prices it does not know', () => {
        expect(invoiceItemsOf(invoice([line('price_base', 27600), line('price_base', -1500, { proration: true }), line('price_other', 500)]), prices)).toEqual({ items: [{ kind: 'plan' }], prorated: false })
    })
})
