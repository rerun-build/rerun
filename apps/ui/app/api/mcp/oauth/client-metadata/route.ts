import { clientMetadataDocument } from '@/lib/mcp-oauth'

export function GET(req: Request) {
    return Response.json(clientMetadataDocument(req), {
        headers: { 'Cache-Control': 'public, max-age=3600' },
    })
}
