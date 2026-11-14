import { stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectMany } from '@/supabase/supabase-helpers'
import { getCreatorAccountState } from './connect.service'

export type RevenueRange = '30d' | '12m' | 'all'

export type CreatorRevenue = {
    currency: string
    totals: { salesCount: number; grossCents: number; feeCents: number; netCents: number; refundedCents: number }
    activeSubscriptions: number
    mrrCents: number
    balance: { availableCents: number; pendingCents: number } | null
    monthly: { month: string; grossCents: number; netCents: number }[]
    byTemplate: { templateId: string | null; slug: string; title: string; salesCount: number; grossCents: number; netCents: number }[]
    recent: { id: string; occurredAt: string; slug: string; title: string; kind: string; grossCents: number; netCents: number }[]
}

const SALE_COLUMNS = [
    'id',
    'template_id',
    'template_slug',
    'template_title',
    'kind',
    'gross_cents',
    'application_fee_cents',
    'net_cents',
    'currency',
    'occurred_at',
] as const

const RECENT_LIMIT = 20

function rangeStart(range: RevenueRange): string | undefined {
    if (range === 'all') return undefined
    const from = new Date()
    if (range === '30d') from.setDate(from.getDate() - 30)
    else from.setMonth(from.getMonth() - 12)
    return from.toISOString()
}

export async function getCreatorRevenue(userId: string, range: RevenueRange): Promise<CreatorRevenue> {
    const supabase = createServiceRoleClient()
    const from = rangeStart(range)

    const [{ data: sales }, { data: subscriptions }, account] = await Promise.all([
        selectAll(supabase, 'template_sales', SALE_COLUMNS, { creator_id: userId, ...(from ? { occurred_at: { gte: from } } : {}) }, { column: 'occurred_at', ascending: false }),
        selectMany(supabase, 'template_purchases', ['amount_cents'] as const, { creator_id: userId, pricing_model: 'recurring', status: 'active' }),
        getCreatorAccountState(userId),
    ])

    const rows = sales ?? []
    const refunds = rows.filter(row => row.kind === 'refund')

    const totals = {
        salesCount: rows.length - refunds.length,
        grossCents: rows.reduce((sum, row) => sum + row.gross_cents, 0),
        feeCents: rows.reduce((sum, row) => sum + row.application_fee_cents, 0),
        netCents: rows.reduce((sum, row) => sum + row.net_cents, 0),
        refundedCents: Math.abs(refunds.reduce((sum, row) => sum + row.gross_cents, 0)),
    }

    const monthly = new Map<string, { month: string; grossCents: number; netCents: number }>()
    for (const row of rows) {
        const month = row.occurred_at.slice(0, 7)
        const entry = monthly.get(month) ?? { month, grossCents: 0, netCents: 0 }
        entry.grossCents += row.gross_cents
        entry.netCents += row.net_cents
        monthly.set(month, entry)
    }

    const byTemplate = new Map<string, CreatorRevenue['byTemplate'][number]>()
    for (const row of rows) {
        const key = row.template_id ?? row.template_slug
        const entry = byTemplate.get(key) ?? { templateId: row.template_id, slug: row.template_slug, title: row.template_title, salesCount: 0, grossCents: 0, netCents: 0 }
        if (row.kind !== 'refund') entry.salesCount += 1
        entry.grossCents += row.gross_cents
        entry.netCents += row.net_cents
        byTemplate.set(key, entry)
    }

    const active = subscriptions ?? []

    return {
        currency: rows[0]?.currency ?? account.defaultCurrency ?? 'usd',
        totals,
        activeSubscriptions: active.length,
        mrrCents: active.reduce((sum, row) => sum + row.amount_cents, 0),
        balance: await readBalance(account.stripeAccountId),
        monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
        byTemplate: [...byTemplate.values()].sort((a, b) => b.netCents - a.netCents),
        recent: rows.slice(0, RECENT_LIMIT).map(row => ({
            id: row.id,
            occurredAt: row.occurred_at,
            slug: row.template_slug,
            title: row.template_title,
            kind: row.kind,
            grossCents: row.gross_cents,
            netCents: row.net_cents,
        })),
    }
}

async function readBalance(stripeAccountId: string | null): Promise<CreatorRevenue['balance']> {
    if (!stripeAccountId) return null
    try {
        const balance = await stripe.balance.retrieve({}, { stripeAccount: stripeAccountId })
        return {
            availableCents: balance.available.reduce((sum, entry) => sum + entry.amount, 0),
            pendingCents: balance.pending.reduce((sum, entry) => sum + entry.amount, 0),
        }
    } catch {
        return null
    }
}
