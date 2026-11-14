import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { decodeIntent } from '@/lib/foreman/kickoff-marker'
import { installedArrival, type ForemanArrival } from '@/lib/foreman/phase'
import { loadForemanState } from '@/lib/foreman/state'
import { resolveForemanSurface } from '@/lib/foreman/surface.server'

export async function GET(req: Request): Promise<Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const intent = decodeIntent(new URL(req.url).searchParams.get('intent'))

    const state = await loadForemanState(ctx, null, intent)
    const planned = state.phase === 'companion' ? null : installedArrival(state.foreman)
    const linked: ForemanArrival | null = state.intent && state.intent.kind !== 'prompt' && state.intent.title ? { kind: state.intent.kind, title: state.intent.title, ...(state.intent.paid ? { paid: state.intent.paid } : {}), ...(state.intent.coworker ? { coworker: state.intent.coworker } : {}) } : null
    const arrival: ForemanArrival | null = planned && state.phase === 'discover' ? { ...planned, installed: true } : (linked ?? planned)
    const surface = await resolveForemanSurface(ctx.workspace.id, state, { canClaim: !ctx.authUser.is_anonymous })
    return Response.json({ phase: state.phase, firstName: state.firstName, arrival, surface })
}
