'use client'

import { createAgentWithSetupAction } from '@/app/api/_actions/services.actions'
import { claimSpaceAction } from '@/app/api/_actions/space.actions'
import { rebaseOffset } from '@/lib/onboarding/target-space'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { toast } from 'sonner'
import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'

export function useStartPendingAgent() {
    const { workspace } = useSession()
    const finalizeAgentCreation = useBoardStore(s => s.finalizeAgentCreation)
    const setStartingFirstAgent = useBoardStore(s => s.setStartingFirstAgent)
    const t = useTranslations('builder.boardToasts')
    const errorText = useErrorText()

    return async function startPendingAgent(): Promise<boolean> {
        if (!workspace) return false
        const draft = useOnboardingStore.getState().pendingFirstAgent
        if (!draft) return false

        setStartingFirstAgent(true)
        try {
            const claim = await claimSpaceAction({ workspaceId: workspace.id })
            if (!claim.ok) {
                toast.error(t('prepareBoxFailed'), { description: errorText(claim) })
                throw new Error(claim.error)
            }

            const anchor = draft.offset ? rebaseOffset(draft.offset, claim) : undefined
            const res = await createAgentWithSetupAction({ name: draft.name, description: draft.description, serviceSlugs: draft.serviceSlugs, workspaceId: workspace.id, spaceId: claim.spaceId, col: anchor?.col, row: anchor?.row })
            if (!res.ok) {
                toast.error(t('startCoworkerFailed'), { description: errorText(res) })
                throw new Error(res.error)
            }

            useOnboardingStore.getState().clearPendingFirstAgent()
            finalizeAgentCreation(res.agentId, draft.description, draft.kickoff)
            return true
        } catch (e) {
            setStartingFirstAgent(false)
            throw e
        }
    }
}
