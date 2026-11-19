import { z } from 'zod'

import { engineAddress, redeemPairingToken, ServerPairingError } from '@/app/api/_services/servers.service'
import { SERVERS_ENABLED } from '@moldwright/cloud/servers'
import { APP_URL } from '@/lib/app-url'

const pairSchema = z.object({
    token: z.string().min(1).max(200),
    url: z.string().max(500).nullish(),
    apiKey: z.string().min(16).max(200),
    version: z.string().max(100).nullish(),
})

function callerIp(req: Request): string | null {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    return forwarded || req.headers.get('x-real-ip')?.trim() || null
}

export async function POST(req: Request): Promise<Response> {
    if (!SERVERS_ENABLED) return Response.json({ error: 'Not found' }, { status: 404 })

    const parsed = pairSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Send { token, apiKey, url? }' }, { status: 400 })

    try {
        const { workspaceId } = await redeemPairingToken({ token: parsed.data.token, apiKey: parsed.data.apiKey, url: engineAddress(parsed.data.url, callerIp(req)) })
        return Response.json({ workspaceId, hubUrl: APP_URL })
    } catch (error) {
        if (error instanceof ServerPairingError) return Response.json({ error: error.message }, { status: error.status })
        console.error('[servers] pairing failed', error)
        return Response.json({ error: 'The pairing failed on the app side. Check its logs.' }, { status: 500 })
    }
}
