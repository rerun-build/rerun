import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { discoverAuthServer } from '@/lib/mcp-oauth'

export async function POST(req: Request) {
    try {
        await requireWorkspaceId()
        const { url } = (await req.json()) as { url?: string }
        if (!url) return Response.json({ error: 'Missing url' }, { status: 400 })

        const metadata = await discoverAuthServer(url)
        return Response.json({ metadata })
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Discovery failed' }, { status: 400 })
    }
}
