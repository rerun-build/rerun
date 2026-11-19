'use client'

import { getSharedTemplateAction, installTemplateAction } from '@/app/api/_actions/template.actions'
import { startTemplateCheckoutAction } from '@moldwright/cloud/marketplace.client'
import { claimSpaceAction } from '@/app/api/_actions/space.actions'
import { rebaseOffset, resolveTargetSpace } from '@/lib/onboarding/target-space'
import { reportInstall } from '@/lib/templates/install-feedback'
import { useTemplateImportFlow } from '@/lib/templates/useTemplateImportFlow'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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
                toast.info(t('settingUp', { title: parked.title }), { description: t('settingUpHint') })
            }

            const positions = parked.offsets?.map(offset => rebaseOffset(offset, corner))
            const result = await installTemplateAction({ slug: parked.slug, spaceId, positions })
            if (!result.ok) {
                toast.error(t('setUpFailed', { title: parked.title }), { description: result.error })
                throw new Error(result.error)
            }

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
