'use client'

import { getSandboxArchiveStateAction } from '@/app/api/_actions/workspace-restore.actions'
import { ensureSandboxSpaceAction } from '@/app/api/_actions/workspace.actions'
import { useSandboxArchiveStore } from '@/stores/sandbox-archive.store'
import { useBoardStore } from '@/stores/board.store'
import { useErrorText } from '@/hooks/useErrorText'
import { useSession } from '@/supabase/session/SessionProvider'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

const RETRY_MS = 30_000

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

        const attempt = async () => {
            if (activeSandboxId.current !== sandboxId) return
            const result = await ensureSandboxSpaceAction().catch(() => ({ ok: false, error: 'Could not prepare your sandbox', code: 'prepareSandboxFailed' }) as const)
            if (result.ok || activeSandboxId.current !== sandboxId) return
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
