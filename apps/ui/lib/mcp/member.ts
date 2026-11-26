import 'server-only'

import type { Actor, UserActor } from '@/app/api/_auth/access'
import { realEmail } from '@/lib/auth/placeholder-email'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import type { User } from '@supabase/supabase-js'

// A key from before keys recorded who created them acts as the workspace: what is done in a
// member's name (an answer to a card, a page of the Brain, a turn with the Chief of Staff) has
// nobody to sign it.
export const NO_MEMBER_BEHIND_KEY = "This API key acts for the workspace, not for one of its members, and this tool works in a member's name. Create a new key in the Rerun app (API keys & MCP) and connect with that one."

export function memberBehindKey(actor: Actor): UserActor {
    if (actor.kind !== 'user') throw new Error(NO_MEMBER_BEHIND_KEY)
    return actor
}

export async function authUserOf(actor: UserActor): Promise<User | null> {
    const { data } = await createServiceRoleClient().auth.admin.getUserById(actor.userId)
    return data.user ?? null
}

export async function memberEmailOf(actor: UserActor): Promise<string | null> {
    return realEmail((await authUserOf(actor))?.email ?? null)
}
