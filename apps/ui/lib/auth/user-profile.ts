import { isAppleRelayEmail, realEmail } from '@/lib/auth/placeholder-email'
import type { User } from '@supabase/supabase-js'

export type UserProfile = { name: string | null; avatarUrl: string | null }

export const PROFILE_NAME_MAX = 80

type Metadata = Record<string, unknown> | undefined

function readString(metadata: Metadata, keys: string[]): string | null {
    for (const key of keys) {
        const value = metadata?.[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
}

export function readProfile(authUser: Pick<User, 'app_metadata' | 'user_metadata'>): UserProfile {
    const chosen: Metadata = authUser.app_metadata
    const avatarWasChosen = !!chosen && 'avatar_url' in chosen
    return {
        name: readString(chosen, ['full_name']) ?? readString(authUser.user_metadata, ['full_name', 'name', 'first_name', 'given_name']),
        avatarUrl: avatarWasChosen ? readString(chosen, ['avatar_url']) : readString(authUser.user_metadata, ['avatar_url', 'picture']),
    }
}

export function displayNameOf(authUser: Pick<User, 'app_metadata' | 'user_metadata' | 'email'>): string | null {
    const name = readProfile(authUser).name
    if (name) return name
    const email = realEmail(authUser.email)
    return email && !isAppleRelayEmail(email) ? email.split('@')[0] : null
}
