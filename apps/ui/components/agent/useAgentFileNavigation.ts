'use client'

import { listFilesAction, type FileEntry } from '@/app/api/_actions/file.actions'
import { useFileNavigation } from '@/components/files/useFileNavigation'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

type FocusedFile = { path: string; directory: string; name: string }

function focusedFile(path: string | null | undefined): FocusedFile | null {
    if (!path) return null
    const slash = path.lastIndexOf('/')
    return {
        path,
        directory: slash === -1 ? '' : path.slice(0, slash),
        name: slash === -1 ? path : path.slice(slash + 1),
    }
}

type UseAgentFileNavigationProps = {
    agentId: string
    focusPath?: string | null
    onFocusConsumed?: () => void
    onOpenFile: (path: string, name: string) => void
}

/** Owns directory loading and the one-shot navigation requested by a chat file link. */
export function useAgentFileNavigation({ agentId, focusPath, onFocusConsumed, onOpenFile }: UseAgentFileNavigationProps) {
    const t = useTranslations('agent.agentFileNavigation')
    const [initialFocus] = useState(() => focusedFile(focusPath))
    const initialFocusRef = useRef<FocusedFile | null>(initialFocus)

    const list = useCallback(async (path: string, showHidden: boolean) => (await listFilesAction(agentId, path, showHidden)).entries, [agentId])

    const consumeFocusedFile = useCallback((path: string, entries: FileEntry[]) => {
        const focused = initialFocusRef.current
        if (!focused || focused.directory !== path) return
        initialFocusRef.current = null
        onFocusConsumed?.()

        const target = entries.find(entry => entry.name === focused.name && entry.type !== 'dir')
        if (!target) {
            toast.error(t('notFound'), { description: focused.path })
            return
        }
        onOpenFile(focused.path, focused.name)
    }, [onFocusConsumed, onOpenFile, t])

    return useFileNavigation<FileEntry>({
        list,
        initialPath: initialFocus?.directory ?? '',
        initialShowHidden: initialFocus?.name.startsWith('.') ?? false,
        onDirectoryLoaded: consumeFocusedFile,
    })
}
