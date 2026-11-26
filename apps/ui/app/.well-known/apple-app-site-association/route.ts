import { iosPasskeyApps } from '@/lib/auth/two-step/passkey-apps'

export const dynamic = 'force-dynamic'

// Lets the iOS app use the passkeys of this domain for the second step of a sign-in.
export function GET() {
    const apps = iosPasskeyApps()
    if (!apps.length) return new Response(null, { status: 404 })
    return Response.json({ webcredentials: { apps } }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
