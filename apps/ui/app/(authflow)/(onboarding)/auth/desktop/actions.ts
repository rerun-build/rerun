'use server'

import { isPkceChallenge, mintDesktopAuthCode } from '@/app/api/_services/desktop-auth.service'
import { readSettledUser } from '@/lib/auth/two-step/gate'
import { createClient } from '@/supabase/server'

export type DesktopApproval = { ok: true; code: string } | { ok: false; reason: 'signed-out' | 'invalid' | 'unavailable' }

// The person confirmed, in their browser, that the desktop app may sign in as them.
export async function approveDesktopSignIn(challenge: string): Promise<DesktopApproval> {
    if (!isPkceChallenge(challenge)) return { ok: false, reason: 'invalid' }
    // An account with two-step approves only once its second step is done: the app's session is
    // raised to the same level from this approval (see the exchange).
    const user = await readSettledUser(await createClient())
    if (!user || user.is_anonymous) return { ok: false, reason: 'signed-out' }
    const code = await mintDesktopAuthCode(user.id, challenge)
    return code ? { ok: true, code } : { ok: false, reason: 'unavailable' }
}
