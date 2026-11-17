'use server'

import { isPkceChallenge, mintDesktopAuthCode } from '@/app/api/_services/desktop-auth.service'
import { createClient } from '@/supabase/server'

export type DesktopApproval = { ok: true; code: string } | { ok: false; reason: 'signed-out' | 'invalid' | 'unavailable' }

// The person confirmed, in their browser, that the desktop app may sign in as them.
export async function approveDesktopSignIn(challenge: string): Promise<DesktopApproval> {
    if (!isPkceChallenge(challenge)) return { ok: false, reason: 'invalid' }
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!data.user || data.user.is_anonymous) return { ok: false, reason: 'signed-out' }
    const code = await mintDesktopAuthCode(data.user.id, challenge)
    return code ? { ok: true, code } : { ok: false, reason: 'unavailable' }
}
