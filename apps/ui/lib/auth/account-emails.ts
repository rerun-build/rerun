import type { User } from '@supabase/supabase-js'

// Signing in with a Google account linked to an existing account opens that account, whose email
// stays the primary one: the account also answers to the verified address of each linked identity.
// It takes the account as the auth server returns it, not the claims of an access token: those
// carry no identity, and a linked address would be refused.
export function ownsEmail(user: User, email: string): boolean {
    const wanted = email.toLowerCase()
    if (user.email?.toLowerCase() === wanted) return true
    return (user.identities ?? []).some(identity => {
        const data = identity.identity_data
        return data?.email_verified === true && typeof data.email === 'string' && data.email.toLowerCase() === wanted
    })
}
