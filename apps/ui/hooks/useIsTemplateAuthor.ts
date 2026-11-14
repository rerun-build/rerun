'use client'

import { useSession } from '@/supabase/session/SessionProvider'

export function useIsTemplateAuthor(): boolean {
    const { user, workspace } = useSession()
    return user?.account_role === 'expert' && workspace?.is_sandbox === true
}
