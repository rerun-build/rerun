'use client'

import { BrainWorkspace, type BrainRequest } from '@/components/brain/BrainWorkspace'
import { selectionForTab } from '@/components/brain/selection'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { usePublishedAccessEnabled } from '@/components/layout/FeatureFlagsProvider'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

// Everything the whole workspace shares: the pages every agent reads about the company, the changes
// agents propose to them, the folder its agents pass files through, and the database they keep
// common records in.
export function KnowledgeBaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.knowledgeBase')
    const focus = useWorkspaceSettingsStore(s => s.focus)
    const clearFocus = useWorkspaceSettingsStore(s => s.clearFocus)
    const { workspace } = useSession()
    const publishedEnabled = usePublishedAccessEnabled() && !(workspace?.is_sandbox ?? true)
    // What the rest of the app asked to open travels as one request, the table along with the
    // section: the database view only mounts once selected, and would miss a table sent apart.
    const [request, setRequest] = useState<BrainRequest | null>(null)

    const consumeRequest = useCallback(() => setRequest(null), [])
    const close = useCallback(() => onOpenChange(false), [onOpenChange])

    useEffect(() => {
        if (!focus?.tab) return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRequest({
            selection: focus.page ? { kind: 'page', slug: focus.page } : selectionForTab(focus.tab),
            data: focus.table ? { table: focus.table, view: focus.view } : null,
        })
        clearFocus()
    }, [focus, clearFocus])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent
                showCloseButton={false}
                className="sm:h-[92dvh] sm:max-w-[min(100rem,95vw)]"
                // Escape in a field (a page title, a rename) leaves the field; the next one closes.
                onEscapeKeyDown={event => {
                    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) event.preventDefault()
                }}
            >
                <DialogTitle className="sr-only">{t('title')}</DialogTitle>
                <DialogDescription className="sr-only">{t('description')}</DialogDescription>
                <BrainWorkspace request={request} publishedEnabled={publishedEnabled} onRequestConsumed={consumeRequest} onClose={close} />
            </PanelDialogContent>
        </Dialog>
    )
}
