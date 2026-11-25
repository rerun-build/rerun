import { requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import type { CompanyFindingsRow } from '@/lib/company/explore/findings'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

async function workspaceContext(): Promise<WorkspaceContext | null> {
    try {
        return await requireWorkspaceContext()
    } catch {
        return null
    }
}

// What the full exploration has written so far, read by the board every few seconds while it runs.
export async function GET() {
    const ctx = await workspaceContext()
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data } = await selectMaybeSingle(ctx.supabase, 'workspace_onboarding', ['company_findings'] as const, { workspace_id: ctx.workspace.id })
    return Response.json((data?.company_findings ?? null) as CompanyFindingsRow | null, { headers: { 'cache-control': 'no-store' } })
}
