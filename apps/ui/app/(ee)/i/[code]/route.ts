import { NextResponse, type NextRequest } from 'next/server'

import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE } from '@/ee/lib/billing/referral'
import { isReferralCode } from '@/ee/services/referral-attach.service'
import { publicUrl } from '@/lib/auth/public-url'
import { routes } from '@/lib/routes'
import { BILLING_ENABLED } from '@rerun/cloud/billing'

export const dynamic = 'force-dynamic'

// A friend's referral link: the code waits in a cookie until the account is born, and the sign-in
// names who invited them. An unknown code is a plain visit to the app.
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
    if (!BILLING_ENABLED) return new Response(null, { status: 404 })

    const code = (await params).code.toLowerCase()
    if (!(await isReferralCode(code))) return NextResponse.redirect(publicUrl(request, routes.home))

    const signIn = publicUrl(request, routes.auth)
    const response = NextResponse.redirect(signIn)
    response.cookies.set(REFERRAL_COOKIE, code, { httpOnly: true, sameSite: 'lax', secure: signIn.startsWith('https:'), maxAge: REFERRAL_COOKIE_MAX_AGE, path: '/' })
    return response
}
