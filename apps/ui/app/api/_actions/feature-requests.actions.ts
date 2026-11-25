'use server'

import type { Database, Json } from '@/app/api/database.types'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { conversationCopy } from '@/app/api/_services/conversation-copy.service'
import { workspaceBrand } from '@/lib/brand/workspace'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { FEATURE_REQUESTS_ENABLED } from '@rerun/cloud/feature-requests'
import { FEATURE_REQUEST_KINDS, FEATURE_REQUEST_LIMITS, isWhiteLabel } from '@rerun/contracts'
import { z } from 'zod'

type FeatureRequestInsert = Database['public']['Tables']['feature_requests']['Insert']

export type SendFeatureRequestResult = { ok: true } | ActionFailure

const toolCallIdSchema = z.string().min(1).max(200)

const sendSchema = z.object({
    sessionId: z.string().uuid(),
    scope: z.enum(['agent', 'foreman']).default('agent'),
    toolCallId: toolCallIdSchema,
    kind: z.enum(FEATURE_REQUEST_KINDS),
    title: z.string().trim().min(1).max(FEATURE_REQUEST_LIMITS.title),
    description: z.string().trim().max(FEATURE_REQUEST_LIMITS.description),
    workaround: z.string().trim().max(FEATURE_REQUEST_LIMITS.workaround).optional(),
})

// What the person sent from the card, edited or not, lands where the Rerun team reads it, with the
// conversation copied beside it: the Box holding it may be gone by the time anyone opens it.
export async function sendFeatureRequestAction(input: z.input<typeof sendSchema>): Promise<SendFeatureRequestResult> {
    if (!FEATURE_REQUESTS_ENABLED) return failure('featureRequestsUnavailable')
    const parsed = sendSchema.safeParse(input)
    if (!parsed.success) return failure('invalidFeatureRequest')
    const { sessionId, scope, toolCallId, kind, title, description, workaround } = parsed.data

    const ctx = await requireWorkspaceContext()
    if (isWhiteLabel(await workspaceBrand(ctx.workspace.id))) return failure('featureRequestsUnavailable')
    const copy = await conversationCopy(ctx, scope, sessionId).catch(() => null)
    if (!copy) return failure('conversationNotFound')

    const { error } = await ctx.supabase.from('feature_requests').upsert<FeatureRequestInsert>(
        {
            workspace_id: ctx.workspace.id,
            user_id: ctx.userId,
            ...copy.keys,
            tool_call_id: toolCallId,
            kind,
            title,
            description,
            workaround: workaround || null,
            transcript: copy.transcript as unknown as Json,
        },
        { onConflict: 'workspace_id,tool_call_id' },
    )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

// A card skipped, then sent later from its receipt: the thread only keeps the skip, the team's table
// knows it left.
export async function featureRequestSentAction(toolCallId: string): Promise<boolean> {
    if (!FEATURE_REQUESTS_ENABLED || !toolCallIdSchema.safeParse(toolCallId).success) return false
    const ctx = await requireWorkspaceContext()
    const { data } = await selectMaybeSingle(ctx.supabase, 'feature_requests', ['id'] as const, { workspace_id: ctx.workspace.id, tool_call_id: toolCallId })
    return data !== null
}
