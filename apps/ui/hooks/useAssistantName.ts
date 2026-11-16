'use client'

import { useSession } from '@/supabase/session/SessionProvider'

// The name the workspace gave its Chief of Staff, null while it has none.
export function useAssistantName(): string | null {
    return useSession().workspace?.assistant_name ?? null
}
