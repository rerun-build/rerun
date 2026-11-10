'use client'

import { getSandboxArchiveStateAction } from '@/app/api/_actions/workspace-restore.actions'
import { ensureSandboxSpaceAction } from '@/app/api/_actions/workspace.actions'
import { useSandboxArchiveStore } from '@/stores/sandbox-archive.store'
import { useBoardStore } from '@/stores/board.store'
import { useErrorText } from '@/hooks/useErrorText'
import { useSession } from '@/supabase/session/SessionProvider'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

// Le pool se remplit en tâche de fond : un claim qui échoue maintenant réussit quelques minutes plus
// tard, sans que l'expert ait à recharger.
const RETRY_MS = 30_000

// Invariant : un sandbox actif a toujours son Space. L'entrée par le switcher le garantit
// (enterSandboxAction), mais `users.workspace_id` est persisté : un reload atterrit directement dans
// le sandbox sans repasser par là — et l'atterrissage d'un creator (resolveCreatorLandingWorkspace)
// bascule volontairement sur un sandbox sans engine quand le pool est vide. Sans ce rattrapage, un
// sandbox sans engine tombe dans la branche générique « recrute ton premier agent » — wizard puis
// paywall, sur un workspace déjà entitled.
export function useEnsureSandboxSpace() {
    const { workspace } = useSession()
    const spaces = useBoardStore(s => s.spaces)
    const hydrated = useBoardStore(s => s.hydrated)
    const errorText = useErrorText()

    const attemptedWorkspaceId = useRef<number | null>(null)
    const activeSandboxId = useRef<number | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => {
        activeSandboxId.current = workspace?.is_sandbox ? workspace.id : null
    }, [workspace])

    useEffect(() => () => clearTimeout(timer.current), [])

    useEffect(() => {
        if (!hydrated || !workspace?.is_sandbox || spaces.length > 0) return
        if (attemptedWorkspaceId.current === workspace.id) return
        attemptedWorkspaceId.current = workspace.id
        const sandboxId = workspace.id

        // On reste dans le sandbox tant qu'il n'a pas son engine : le board affiche « Preparing your
        // sandbox… » et le Space arrive par le realtime dès que le claim passe. La boucle survit aux
        // re-renders (pas de cleanup qui l'annule), et s'arrête d'elle-même si l'expert change de
        // workspace entre deux essais.
        const attempt = async () => {
            if (activeSandboxId.current !== sandboxId) return
            // L'action renvoie le pool vide en valeur, mais sa garde d'autorisation, elle, jette :
            // il faut le catch pour ne pas laisser passer une rejection non gérée.
            const result = await ensureSandboxSpaceAction().catch(() => ({ ok: false, error: 'Could not prepare your sandbox', code: 'prepareSandboxFailed' }) as const)
            if (result.ok || activeSandboxId.current !== sandboxId) return
            // Archivé pour inactivité : aucun retry ne passera avant une approbation. La bannière
            // prend le relais, y compris après la purge, quand la session ne porte plus aucun signe
            // de l'archive.
            if ('locked' in result) {
                const archive = await getSandboxArchiveStateAction().catch(() => null)
                if (activeSandboxId.current === sandboxId) useSandboxArchiveStore.getState().setArchive(sandboxId, archive)
                return
            }

            toast.error(errorText(result))
            timer.current = setTimeout(() => void attempt(), RETRY_MS)
        }

        void attempt()
    }, [hydrated, workspace, spaces.length, errorText])
}
