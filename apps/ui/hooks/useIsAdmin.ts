'use client'

import { useSession } from '@/supabase/session/SessionProvider'

export function useIsAdmin(): boolean {
    return useSession().isAdmin === true
}
