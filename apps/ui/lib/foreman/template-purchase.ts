import 'server-only'

import type { TemplatePricing, TemplatePricingModel } from '@moldwright/contracts'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { hasTemplateEntitlement } from '@/lib/templates/entitlement'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { ForemanPlan } from './phase'

export type OwedTemplatePurchase = { slug: string; title: string; pricing: TemplatePricing }

const PURCHASE_COLUMNS = ['id', 'slug', 'title', 'pricing_model', 'price_amount_cents', 'price_currency', 'creator_id'] as const

export async function owedTemplatePurchase(ctx: WorkspaceContext, plan: ForemanPlan | undefined): Promise<OwedTemplatePurchase | null> {
    const item = plan?.items.find(candidate => candidate.kind === 'template')
    if (item?.kind !== 'template') return null

    const { data: template } = await selectMaybeSingle(ctx.supabase, 'templates', PURCHASE_COLUMNS, { slug: item.slug })
    if (!template || (await hasTemplateEntitlement(ctx.supabase, ctx.workspace.id, template, ctx.userId))) return null

    return { slug: template.slug, title: template.title, pricing: { model: template.pricing_model as TemplatePricingModel, amountCents: template.price_amount_cents, currency: template.price_currency } }
}
