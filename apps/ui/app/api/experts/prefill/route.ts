import { secretMatches } from '@/lib/secure-compare'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { triggerTask } from '@moldwright/cloud/tasks'
import type { prefillExpertApplicationTask } from '@/trigger/prefill-expert-application'

export async function POST(req: Request) {
    const secret = process.env.EXPERTS_PREFILL_SECRET
    if (!secret) return Response.json({ error: 'EXPERTS_PREFILL_SECRET is not configured' }, { status: 500 })
    if (!secretMatches(req.headers.get('x-prefill-secret'), secret)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let expertId: string | undefined
    try {
        const body = (await req.json()) as { expertId?: unknown }
        if (typeof body?.expertId === 'string') expertId = body.expertId
    } catch {
    }
    if (!expertId) return Response.json({ error: 'expertId is required' }, { status: 400 })

    const supabase = createServiceRoleClient()
    const { data: expert } = await selectMaybeSingle(supabase, 'experts', ['id', 'source'] as const, { id: expertId })
    if (!expert || expert.source !== 'application') return Response.json({ error: 'Not an application' }, { status: 404 })

    await triggerTask<typeof prefillExpertApplicationTask>('prefill-expert-application', { expertId })
    return Response.json({ queued: true }, { status: 202 })
}
