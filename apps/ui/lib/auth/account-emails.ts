import type { User } from '@supabase/supabase-js'

export function ownsEmail(user: Pick<User, 'email' | 'identities'>, email: string): boolean {
    const wanted = email.toLowerCase()
    if (user.email?.toLowerCase() === wanted) return true
    return (user.identities ?? []).some(identity => {
        const data = identity.identity_data
        return data?.email_verified === true && typeof data.email === 'string' && data.email.toLowerCase() === wanted
    })
}
