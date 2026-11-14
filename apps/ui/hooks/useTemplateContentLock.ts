'use client'

import { isTemplateContentLocked } from '@/lib/templates/content-lock'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'

export function useTemplateContentLock(agentId: string): boolean {
    const { workspace } = useSession()
    const templateId = useBoardStore(s => s.agents.find(agent => agent.id === agentId)?.templateId ?? null)
    return isTemplateContentLocked({ templateId }, workspace)
}
