import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { MARKETPLACE_ENABLED } from '@rerun/cloud/marketplace'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

export const ENTITLED_PURCHASE_STATUSES = ['active', 'past_due'] as const

export type PurchaseAccess = 'none' | 'active' | 'lapsed' | 'refunded'

export type EntitlementSubject = { id: string; pricing_model: string; creator_id: string | null }

function accessOf(status: string | undefined): PurchaseAccess {
    if (!status) return 'none'
    if (status === 'active' || status === 'past_due') return 'active'
    if (status === 'refunded') return 'refunded'
    return status === 'canceled' ? 'lapsed' : 'none'
}

export async function templateAccessByWorkspace(supabase: SupabaseClient<Database>, workspaceId: number): Promise<Map<string, PurchaseAccess>> {
    const { data } = await selectMany(supabase, 'template_purchases', ['template_id', 'status'] as const, { workspace_id: workspaceId })
    return new Map((data ?? []).map(row => [row.template_id, accessOf(row.status)]))
}

export async function hasTemplateEntitlement(
    supabase: SupabaseClient<Database>,
    workspaceId: number,
    template: EntitlementSubject,
    viewerId?: string | null,
): Promise<boolean> {
    if (!MARKETPLACE_ENABLED || template.pricing_model === 'free') return true
    if (viewerId && template.creator_id === viewerId) return true

    const { data } = await selectMaybeSingle(supabase, 'template_purchases', ['status'] as const, { workspace_id: workspaceId, template_id: template.id })
    return !!data && (ENTITLED_PURCHASE_STATUSES as readonly string[]).includes(data.status)
}
