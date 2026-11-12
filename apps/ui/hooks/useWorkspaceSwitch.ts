'use client'

import { switchWorkspaceAction } from '@/app/api/_actions/workspace.actions'
import { useErrorText } from '@/hooks/useErrorText'
import { abortWorkspaceSwitch, beginWorkspaceSwitch, enterActiveWorkspace } from '@/lib/workspace/workspace-switch'
import { useState } from 'react'
import { toast } from 'sonner'

export function useWorkspaceSwitch(currentWorkspaceId: number | undefined) {
    const errorText = useErrorText()
    const [busy, setBusy] = useState(false)

    async function switchTo(workspaceId: number) {
        if (busy || workspaceId === currentWorkspaceId) return
        setBusy(true)
        beginWorkspaceSwitch()
        const result = await switchWorkspaceAction(workspaceId)
        if (result.ok) return enterActiveWorkspace()
        abortWorkspaceSwitch()
        toast.error(errorText(result))
        setBusy(false)
    }

    return { switchTo, busy }
}
