'use client'

import { getSharedTemplateAction, installTemplateAction } from '@/app/api/_actions/template.actions'
import { startTemplateCheckoutAction } from '@rerun/cloud/marketplace.client'
import { claimSpaceAction } from '@/app/api/_actions/space.actions'
import { rebaseOffset, resolveTargetSpace } from '@/lib/onboarding/target-space'
import { reportInstall } from '@/lib/templates/install-feedback'
import { useTemplateImportFlow } from '@/lib/templates/useTemplateImportFlow'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

// The template counterpart of useStartPendingAgent: claims a Space when the workspace has none,
// then unpacks the template's captured agents into it. Shared by the trial start and the
// post-payment return. Resolves to false when no template is parked; throws on failure after
// toasting, leaving the parked entry in place so the chain can be retried.
export function useStartPendingTemplate() {
    const { workspace } = useSession()
    const t = useTranslations('templates.installFeedback')
    const setStartingFirstAgent = useBoardStore(s => s.setStartingFirstAgent)
    const selectAgentWhenReady = useBoardStore(s => s.selectAgentWhenReady)
    const { run: startImport } = useTemplateImportFlow({ onDone: () => {} })

    return async function startPendingTemplate(): Promise<boolean> {
        if (!workspace) return false
        const parked = useOnboardingStore.getState().pendingTemplate
        if (!parked) return false

        // Parkée depuis une fiche : rien n'a encore été placé, donc on reprend l'échelle au lieu
        // d'installer. Le plan vient d'être acquis, restent la porte achat puis le placement, que
        // l'utilisateur fait lui-même sur le board.
        if (parked.needsPlacement) {
            const template = await getSharedTemplateAction(parked.slug)
            if (!template) {
                toast.error(t('noLongerAvailable', { title: parked.title }))
                useOnboardingStore.getState().clearPendingTemplate()
                return false
            }

            if (!template.owned) {
                const result = await startTemplateCheckoutAction(parked.slug)
                if (!result.ok) {
                    toast.error(t('buyFailed', { title: parked.title }), { description: result.error })
                    throw new Error(result.error)
                }
                // Le checkout ramène sur `?template=<slug>&purchase=success`, où la fiche de succès
                // reprend le placement : l'entrée parkée n'a plus rien à porter.
                if (result.outcome.kind === 'checkout') {
                    useOnboardingStore.getState().clearPendingTemplate()
                    window.location.href = result.outcome.url
                    return true
                }
            }

            useOnboardingStore.getState().clearPendingTemplate()
            startImport(template)
            return true
        }

        setStartingFirstAgent(true)
        try {
            // A Space may already be there by now: conversion into an account that has one, a
            // second tab, or a retry after a failed install. Reuse it rather than claiming another.
            const existing = await resolveTargetSpace(workspace.id)
            let spaceId = existing?.id
            let corner = existing ? { colStart: existing.col_start, rowStart: existing.row_start } : null
            if (!spaceId || !corner) {
                const claim = await claimSpaceAction({ workspaceId: workspace.id })
                if (!claim.ok) {
                    toast.error(t('prepareBoxFailed'), { description: claim.error })
                    throw new Error(claim.error)
                }
                spaceId = claim.spaceId
                corner = { colStart: claim.colStart, rowStart: claim.rowStart }
                // The Space row lands through realtime, which turns the board's loading placeholder
                // off well before the archives are downloaded and unpacked. Without this the board
                // sits empty and silent for the whole import.
                toast.info(t('settingUp', { title: parked.title }), { description: t('settingUpHint') })
            }

            // The agents land where the user dropped them on the placeholder, rebased on the Space
            // that ended up hosting them.
            const positions = parked.offsets?.map(offset => rebaseOffset(offset, corner))
            const result = await installTemplateAction({ slug: parked.slug, spaceId, positions })
            if (!result.ok) {
                toast.error(t('setUpFailed', { title: parked.title }), { description: result.error })
                throw new Error(result.error)
            }

            // Agents réellement posés : seul moment où l'on nettoie l'entrée parkée.
            useOnboardingStore.getState().clearPendingTemplate()
            reportInstall(result, parked.title)
            if (result.agentIds[0]) selectAgentWhenReady(result.agentIds[0])
            return true
        } catch (e) {
            setStartingFirstAgent(false)
            throw e
        }
    }
}
