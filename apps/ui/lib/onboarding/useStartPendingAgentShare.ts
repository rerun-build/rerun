'use client'

import { getSharedAgentAction } from '@/app/api/_actions/agent-share.actions'
import { claimSpaceAction } from '@/app/api/_actions/space.actions'
import { resolveTargetSpace } from '@/lib/onboarding/target-space'
import { useAgentShareStore } from '@/stores/agent-share.store'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { toast } from 'sonner'
import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'

export function useStartPendingAgentShare() {
    const { workspace } = useSession()
    const beginAgentSharePlacement = useBoardStore(s => s.beginAgentSharePlacement)
    const t = useTranslations('builder.boardToasts')
    const errorText = useErrorText()

    return async function startPendingAgentShare(): Promise<boolean> {
        if (!workspace) return false
        const token = useOnboardingStore.getState().pendingShareLink
        if (!token) return false

        const preview = await getSharedAgentAction(token)
        if (!preview) {
            toast.error(t('shareLinkGone'))
            useOnboardingStore.getState().clearPendingShareLink()
            return false
        }

        const existing = await resolveTargetSpace(workspace.id)
        if (!existing) {
            const claim = await claimSpaceAction({ workspaceId: workspace.id })
            if (!claim.ok) {
                toast.error(t('prepareBoxFailed'), { description: errorText(claim) })
                throw new Error(claim.error)
            }
        }

        useOnboardingStore.getState().clearPendingShareLink()
        useAgentShareStore.getState().closeLink()
        beginAgentSharePlacement({ token, agentName: preview.agent.name })
        return true
    }
}
