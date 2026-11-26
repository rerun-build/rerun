import { androidPasskeyApps } from '@/lib/auth/two-step/passkey-apps'

export const dynamic = 'force-dynamic'

// Lets the Android app use the passkeys of this domain for the second step of a sign-in.
export function GET() {
    const apps = androidPasskeyApps()
    if (!apps.length) return new Response(null, { status: 404 })
    return Response.json(
        apps.map(({ packageName, fingerprint }) => ({
            relation: ['delegate_permission/common.get_login_creds'],
            target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: [fingerprint] },
        })),
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
    )
}
