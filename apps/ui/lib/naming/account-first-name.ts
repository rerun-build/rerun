import 'server-only'

import { getAuthUser, type SessionIdentity } from '@/supabase/session/getServerSession'
import { readFirstName } from './first-name'

// The session's identity is what the access token said when it was issued. A first name given
// since (the onboarding writes it with the admin API, which reissues nothing) only reaches the
// token at its next refresh, up to an hour later. So an identity that holds none is not taken at
// its word: the auth server is asked, which only costs the accounts still without a name.
export async function accountFirstName(identity: Pick<SessionIdentity, 'user_metadata'> | null | undefined): Promise<string> {
    if (!identity) return ''
    return readFirstName(identity.user_metadata) || readFirstName((await getAuthUser())?.user_metadata)
}
