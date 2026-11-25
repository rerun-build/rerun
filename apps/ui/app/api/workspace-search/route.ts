import { requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { searchWorkspaceContent } from '@/app/api/_services/workspace-search.service'

// A route and not a server action: Next runs one action at a time per client, so a search the next
// keystroke replaced would hold back every action behind it, and could not be cancelled.
export async function GET(req: Request): Promise<Response> {
    let ctx: WorkspaceContext
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    try {
        return Response.json(await searchWorkspaceContent(ctx, new URL(req.url).searchParams.get('q') ?? '', req.signal))
    } catch (err) {
        console.error('[workspace-search] failed', err)
        return Response.json({ error: 'Search failed' }, { status: 500 })
    }
}
