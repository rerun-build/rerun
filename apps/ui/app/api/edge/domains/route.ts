import { servedDomainHostnames } from '@rerun/cloud/organizations.server'

import { isEdge } from '@/app/api/edge/_lib/edge-key'

export const dynamic = 'force-dynamic'

// What the job beside Traefik reads every minute: the domains of the organizations it must hand to the
// edge, one per line. A failure is an error, never an empty list: the job keeps the routes it has.
export async function GET(req: Request) {
    if (!isEdge(req.headers.get('x-edge-key'))) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    try {
        const hostnames = await servedDomainHostnames()
        return new Response(hostnames.map(hostname => `${hostname}\n`).join(''), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
    } catch (err) {
        console.error('[edge] the served domains could not be read', err)
        return new Response(null, { status: 500, headers: { 'Cache-Control': 'no-store' } })
    }
}
