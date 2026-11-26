import type Stripe from 'stripe'

import { APP_ADDON_KEYS, APP_SLUGS, type AppSlug } from '@/lib/apps/types'
import type { AddonKey } from '@/ee/lib/billing/plans'

export const CREDIT_PURCHASE_KIND = 'credit_purchase'

// What an invoice charged for, so a list of invoices can name each one ("Pro + LinkedIn Pro",
// "Credit pack × 2"). `prorated` marks an invoice that only carries the part of a period an add-on
// was bought for.
export type InvoiceItem = { kind: 'plan' } | { kind: 'app'; app: AppSlug; quantity: number } | { kind: 'credit_pack'; quantity: number }

export type InvoiceItems = { items: InvoiceItem[]; prorated: boolean }

type PriceReaders = { isBasePriceId: (priceId: string) => boolean; addonForPriceId: (priceId: string) => AddonKey | undefined }

function linePriceId(line: Stripe.InvoiceLineItem): string | null {
    const price = line.pricing?.price_details?.price
    if (!price) return null
    return typeof price === 'string' ? price : price.id
}

function isProration(line: Stripe.InvoiceLineItem): boolean {
    return !!(line.parent?.subscription_item_details?.proration || line.parent?.invoice_item_details?.proration)
}

function appOfAddon(addon: AddonKey | undefined): AppSlug | undefined {
    return APP_SLUGS.find(slug => APP_ADDON_KEYS[slug] === addon)
}

export function invoiceItemsOf(invoice: Pick<Stripe.Invoice, 'metadata' | 'lines'>, prices: PriceReaders): InvoiceItems {
    if (invoice.metadata?.kind === CREDIT_PURCHASE_KIND) {
        const packs = Number(invoice.metadata.packs)
        return { items: [{ kind: 'credit_pack', quantity: Number.isInteger(packs) && packs > 0 ? packs : 1 }], prorated: false }
    }

    const charged = (invoice.lines?.data ?? []).filter(line => line.amount > 0)
    const full = charged.filter(line => !isProration(line))
    const lines = full.length > 0 ? full : charged
    const items: InvoiceItem[] = []
    for (const line of lines) {
        const priceId = linePriceId(line)
        if (!priceId) continue
        if (prices.isBasePriceId(priceId)) {
            if (!items.some(item => item.kind === 'plan')) items.unshift({ kind: 'plan' })
            continue
        }
        const app = appOfAddon(prices.addonForPriceId(priceId))
        if (!app) continue
        const quantity = line.quantity ?? 1
        const existing = items.find(item => item.kind === 'app' && item.app === app)
        if (existing && existing.kind === 'app') existing.quantity += quantity
        else items.push({ kind: 'app', app, quantity })
    }
    return { items, prorated: full.length === 0 && charged.length > 0 }
}
