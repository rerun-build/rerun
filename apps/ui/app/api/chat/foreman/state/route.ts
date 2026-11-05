import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { decodeIntent } from '@/lib/foreman/kickoff-marker'
import { installedArrival, type ForemanArrival } from '@/lib/foreman/phase'
import { loadForemanState } from '@/lib/foreman/state'
import { resolveForemanSurface } from '@/lib/foreman/surface.server'

// Where the workspace stands, for the browser. The board needs it before the first message to know
// whether the column opens as a guide, as the welcome card, as the foreman on the engine, or not at
// all, and it is the only thing it needs: the phase itself is decided server-side on every turn.
export async function GET(req: Request): Promise<Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // The intent rides in the query string here, and only here: this is the one call that runs
    // before the transcript the marker lives in exists. Reading it changes nothing, so a GET stays
    // honest.
    const intent = decodeIntent(new URL(req.url).searchParams.get('intent'))

    const state = await loadForemanState(ctx, null, intent)
    // The first name rides along because the welcome card skips its last question for someone we
    // already know, and this is the only call it makes before showing itself. So does what they came
    // in for, which the card names above its first question: a link that could not be read loses its
    // title and the card simply says nothing, rather than reading a slug back at them.
    // Once it is installed the link is no longer parked in the browser, so the card reads what it
    // names from the plan the link was written down as.
    // The plan also names it for a tab that lost the link on the way: back from the template's
    // checkout, or reloaded in the middle of the install.
    const planned = state.phase === 'companion' ? null : installedArrival(state.foreman)
    const linked: ForemanArrival | null = state.intent && state.intent.kind !== 'prompt' && state.intent.title ? { kind: state.intent.kind, title: state.intent.title, ...(state.intent.paid ? { paid: state.intent.paid } : {}), ...(state.intent.coworker ? { coworker: state.intent.coworker } : {}) } : null
    const arrival: ForemanArrival | null = planned && state.phase === 'discover' ? { ...planned, installed: true } : (linked ?? planned)
    const surface = await resolveForemanSurface(ctx.workspace.id, state, { canClaim: !ctx.authUser.is_anonymous })
    return Response.json({ phase: state.phase, firstName: state.firstName, arrival, surface })
}
