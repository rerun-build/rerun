'use server'

import { z } from 'zod'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import {
    confirmTemplateCheckoutSession,
    createTemplateCheckoutSession,
    NO_PLAN_ERROR,
    type TemplateCheckoutOutcome,
} from '@/ee/services/template-checkout.service'
import { templateAccessByWorkspace, type PurchaseAccess } from '@/lib/templates/entitlement'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'
import type { ActionResult } from '@/app/api/_actions/space.actions'

// A purchase is made by a workspace: any member may start one, and the button says whose card it
// lands on. `purchased_by` keeps the record of who clicked.

const slugSchema = z.string().trim().min(1).max(200)

export type StartCheckoutResult = ActionResult<{ outcome: TemplateCheckoutOutcome }> | (ActionFailure & { needsPlan: true })

export async function startTemplateCheckoutAction(slug: string): Promise<StartCheckoutResult> {
    try {
        const outcome = await createTemplateCheckoutSession(slugSchema.parse(slug))
        return { ok: true, outcome }
    } catch (err) {
        if (err instanceof Error && err.message === NO_PLAN_ERROR) return { ...failure('templateNeedsPlan'), needsPlan: true }
        return failureOf(err, 'startCheckoutFailedDot')
    }
}

export async function confirmTemplatePurchaseAction(sessionId: string): Promise<ActionResult<{ entitled: boolean }>> {
    try {
        const { entitled } = await confirmTemplateCheckoutSession(z.string().trim().min(1).max(200).parse(sessionId))
        return { ok: true, entitled }
    } catch (err) {
        return failureOf(err, 'confirmPurchaseFailed')
    }
}

// What the purchase dialog polls while it waits for the webhook, and what the library re-reads
// after one lands.
export async function getTemplateAccessAction(slug: string): Promise<ActionResult<{ access: PurchaseAccess }>> {
    try {
        const workspaceId = await requireWorkspaceId()
        const supabase = createServiceRoleClient()

        const { data: template } = await selectMaybeSingle(supabase, 'templates', ['id', 'pricing_model'] as const, { slug: slugSchema.parse(slug) })
        if (!template) return failure('templateNotFoundDot')
        if (template.pricing_model === 'free') return { ok: true, access: 'active' }

        const access = await templateAccessByWorkspace(supabase, workspaceId)
        return { ok: true, access: access.get(template.id) ?? 'none' }
    } catch (err) {
        return failureOf(err, 'readPurchasesFailed')
    }
}
