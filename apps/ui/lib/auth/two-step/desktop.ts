import 'server-only'

import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { asksSecondStep } from './gate'
import { elevateSession } from './recovery'
import { readTwoStep } from './store'

// The desktop app's session is opened by the hub from a magic link, so it starts at aal1 whatever the
// browser that approved it had done. An account with two-step approves only at aal2, so the hub
// raises the new session with its recovery factor. False when it cannot: the app is then not signed in.
export async function raiseLikeTheBrowser(session: SupabaseClient<Database>, userId: string): Promise<boolean> {
    const { data } = await session.auth.getUser()
    if (!data.user || !asksSecondStep(data.user)) return true
    try {
        const { recovery } = await readTwoStep(userId)
        if (!recovery) return false
        await elevateSession(session, recovery)
        return true
    } catch (err) {
        console.error('[two-step] desktop session not raised', err instanceof Error ? err.message : err)
        await session.auth.signOut({ scope: 'local' }).catch(() => {})
        return false
    }
}
