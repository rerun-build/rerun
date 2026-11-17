'use server'

import { LAST_SIGN_IN_COOKIE, LAST_SIGN_IN_MAX_AGE_SECONDS } from '@/lib/auth/last-sign-in-cookie'
import { internalPath } from '@/lib/auth/internal-path'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { routes } from '@/lib/routes'
import { createClient } from '@/supabase/server'
import { captureServer } from '@rerun/analytics/server'
import { type EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Consumes the emailed sign-in token (verifyOtp) and sets the session cookies. Fired by an explicit
// POST (the click), so the browser's prefetch of the link never spends the token.
export async function confirmLogin(formData: FormData) {
    const tokenHash = formData.get('token_hash')?.toString()
    const type = formData.get('type')?.toString() as EmailOtpType | undefined
    const cookieStore = await cookies()

    let ok = false
    if (tokenHash && type) {
        const supabase = await createClient()
        const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        ok = !error
        const email = data.user?.email
        if (ok && email) {
            const sentAt = cookieStore.get('rr_verif_sent_at')?.value
            const delay_seconds = sentAt ? Math.round((Date.now() - Number(sentAt)) / 1000) : undefined
            await captureServer(email, 'email_verification_completed', { via: 'link', delay_seconds })
        }
    }
    if (!ok) redirect(routes.authCodeError)
    cookieStore.set(LAST_SIGN_IN_COOKIE, 'email', { path: '/', maxAge: LAST_SIGN_IN_MAX_AGE_SECONDS, sameSite: 'lax' })

    const pendingInvite = cookieStore.get(PENDING_INVITE_COOKIE)?.value
    if (pendingInvite) cookieStore.delete(PENDING_INVITE_COOKIE)
    redirect(internalPath(pendingInvite, routes.home))
}
