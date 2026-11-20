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

// Claims a Space from the pool and creates the parked first-agent draft inside it. Shared by the
// trial start (BillingDialog) and the post-payment return (PostPaymentDialog). Resolves to false
// when there is no parked draft (nothing to do); throws on a claim/create failure after toasting.
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

        // On a un draft à créer : bascule la grille en état loading. Le placeholder d'onboarding
        // affiche un spinner jusqu'à l'insert realtime de l'espace réel (qui remet le flag à false),
        // au lieu de réafficher « Click to recruit ». Sur échec on le remet à false ici même.
        setStartingFirstAgent(true)
        try {
            // Le nom de la Box est résolu côté serveur (naming.service) : la ligne users lue ici
            // arrive par le realtime et a parfois un tour de retard sur la fin de la survey.
            const claim = await claimSpaceAction({ workspaceId: workspace.id })
            if (!claim.ok) {
                toast.error(t('prepareBoxFailed'), { description: errorText(claim) })
                throw new Error(claim.error)
            }

            // L'agent atterrit là où l'utilisateur l'a lâché sur le bloc fantôme, rebasé sur le Space
            // qui vient d'être réclamé. Sans ancre (brouillon d'avant le placement), le serveur choisit.
            const anchor = draft.offset ? rebaseOffset(draft.offset, claim) : undefined
            const res = await createAgentWithSetupAction({ name: draft.name, description: draft.description, serviceSlugs: draft.serviceSlugs, workspaceId: workspace.id, spaceId: claim.spaceId, col: anchor?.col, row: anchor?.row })
            if (!res.ok) {
                toast.error(t('startCoworkerFailed'), { description: errorText(res) })
                throw new Error(res.error)
            }

            // Agent réellement placé : c'est le seul moment où l'on nettoie le brouillon (store +
            // localStorage).
            useOnboardingStore.getState().clearPendingFirstAgent()
            finalizeAgentCreation(res.agentId, draft.description, draft.kickoff)
            return true
        } catch (e) {
            setStartingFirstAgent(false)
            throw e
        }
    }
}
