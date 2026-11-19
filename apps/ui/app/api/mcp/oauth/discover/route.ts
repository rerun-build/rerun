import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { refusal, refusalOf } from '@/lib/i18n/action-error'
import { discoverAuthServer } from '@/lib/mcp-oauth'

// Pre-flight before the popup: checks the MCP server is public and advertises an OAuth
// authorization server, so an error shows up before Connect. /start runs its own discovery and
// resolves the client there, so nothing returned here is trusted later.
export async function POST(req: Request) {
    try {
        await requireWorkspaceId()
        const { url } = (await req.json()) as { url?: string }
        if (!url) return Response.json(refusal('missingUrl'), { status: 400 })

        const metadata = await discoverAuthServer(url)
        return Response.json({ metadata })
    } catch (err) {
        return Response.json(refusalOf(err, 'discoveryFailed'), { status: 400 })
    }
}
