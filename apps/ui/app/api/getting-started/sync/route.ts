import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { catchUpEngineSteps, catchUpPaymentMethod, grantGettingStartedReward, markGettingStarted, readGettingStartedItems, reportGettingStartedSteps } from '@/app/api/_services/getting-started.service'

export async function POST(): Promise<Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (ctx.workspace.is_sandbox) return Response.json({ visible: false })

    const workspaceId = ctx.workspace.id
    await reportGettingStartedSteps(ctx.supabase, workspaceId)
    const items = await readGettingStartedItems(ctx.supabase, workspaceId)
    if (items.has('dismissed')) return Response.json({ visible: false, dismissed: true })

    const found = (await Promise.all([catchUpEngineSteps(ctx.supabase, workspaceId, items), catchUpPaymentMethod(ctx.supabase, workspaceId, items)])).flat()
    await markGettingStarted(ctx.supabase, workspaceId, found)
    for (const item of found) items.add(item)

    await grantGettingStartedReward(ctx.supabase, workspaceId, items)
    return Response.json({ visible: true })
}
