'use client'

import { getSharedAgentAction } from '@/app/api/_actions/agent-share.actions'
import { claimSpaceAction } from '@/app/api/_actions/space.actions'
import { resolveTargetSpace } from '@/lib/onboarding/target-space'
import { useAgentShareStore } from '@/stores/agent-share.store'
import { useBoxViewer } from '@/hooks/useBoxAccess'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { toast } from 'sonner'
import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'

// The share counterpart of useStartPendingTemplate, and deliberately the shorter one: a share has
// no purchase door, so once the plan is in place all that is left is a Space to drop into.
//
// It claims that Space rather than installing straight away. Without it, someone who met the link
// before having a workspace would come back from checkout to a board with nowhere to place, drop on
// the onboarding placeholder again, and be sent back to the paywall they just paid.
export function useStartPendingAgentShare() {
    const { workspace } = useSession()
    const requestCreation = useBoardStore(s => s.requestCreation)
    const viewer = useBoxViewer()
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

        // A Space may already be there by now: conversion into an account that has one, a second
        // tab, or a retry. Reuse it rather than claiming another.
        const existing = await resolveTargetSpace(workspace.id)
        if (!existing) {
            const claim = await claimSpaceAction({ workspaceId: workspace.id })
            if (!claim.ok) {
                toast.error(t('prepareBoxFailed'), { description: errorText(claim) })
                throw new Error(claim.error)
            }
        }

        // Cleared only now: up to here the entry is what brings the card back on a reload.
        useOnboardingStore.getState().clearPendingShareLink()
        useAgentShareStore.getState().closeLink()
        requestCreation({ kind: 'share', token, agentName: preview.agent.name }, viewer)
        return true
    }
}
