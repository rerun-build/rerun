import type { User } from '@supabase/supabase-js'

// Signing in with a Google account linked to an existing account opens that account, whose email
// stays the primary one: the account also answers to the verified address of each linked identity.
export function ownsEmail(user: Pick<User, 'email' | 'identities'>, email: string): boolean {
    const wanted = email.toLowerCase()
    if (user.email?.toLowerCase() === wanted) return true
    return (user.identities ?? []).some(identity => {
        const data = identity.identity_data
        return data?.email_verified === true && typeof data.email === 'string' && data.email.toLowerCase() === wanted
    })
}
