import { z } from 'zod'

import { ComputerConnectError, connectComputer } from '@/app/api/_services/remote-computers.service'
import { allowConnectAttempt } from './attempts'

const bodySchema = z.object({ appVersion: z.string().max(64).optional() }).catch({})

// Called by the desktop app before each connection of a linked computer, with the token it keeps
// for that link. It answers the socket to open, with a one-minute ticket that names the computer.
// `revoked` and `invalid` tell the app the link is gone; the others to try again later.
export async function POST(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token || token.length > 200) return Response.json({ error: 'invalid' }, { status: 401 })
    if (!allowConnectAttempt(token)) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'retry-after': '60' } })

    const { appVersion } = bodySchema.parse(await req.json().catch(() => ({})))
    try {
        const { socketUrl, computer } = await connectComputer(token, appVersion ?? null)
        return Response.json({ socketUrl, computer }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
        if (error instanceof ComputerConnectError) return Response.json({ error: error.reason }, { status: error.status, headers: error.status === 503 ? { 'retry-after': '60' } : {} })
        console.error('[computers] connect failed', error)
        return Response.json({ error: 'internal' }, { status: 500 })
    }
}
