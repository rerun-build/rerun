import { openDesktopSession, redeemDesktopAuthCode } from '@/app/api/_services/desktop-auth.service'
import { createClient } from '@/supabase/server'
import { parseDesktopShellUserAgent } from '@rerun/contracts'
import { z } from 'zod'

const exchangeSchema = z.object({ code: z.string().max(128), verifier: z.string().max(128) })

const NO_STORE = { 'Cache-Control': 'no-store' }

// The desktop app spends the code the browser handed it, with the PKCE verifier only it holds. The
// session opens on this request's cookies, which are the app window's own.
export async function POST(request: Request) {
    if (!parseDesktopShellUserAgent(request.headers.get('user-agent'))) return Response.json({ reason: 'invalid' }, { status: 403, headers: NO_STORE })
    const parsed = exchangeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ reason: 'invalid' }, { status: 400, headers: NO_STORE })
    const redemption = await redeemDesktopAuthCode(parsed.data.code, parsed.data.verifier)
    if (!redemption.ok) return Response.json({ reason: redemption.reason }, { status: redemption.reason === 'unavailable' ? 503 : 400, headers: NO_STORE })
    const opened = await openDesktopSession(await createClient(), redemption.userId)
    if (!opened) return Response.json({ reason: 'unavailable' }, { status: 503, headers: NO_STORE })
    return Response.json({ ok: true }, { headers: NO_STORE })
}
