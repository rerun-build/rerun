'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import type { SaveFileResult } from '@/app/api/_services/file.service'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { FileTextIcon } from '@/lib/icons'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'

import { FileTextEditor } from './FileTextEditor'
import { useFileDraft } from './useFileDraft'

type FileEditorDialogProps = {
    fileName: string
    initialContent: string
    onSave: (content: string, baseHash: string | null) => Promise<SaveFileResult>
    onSaved: (content: string) => void
    onClose: () => void
}

// Mounted only while editing, so it opens on content that has finished loading and unmounting it is
// what throws a draft away. Being modal is also what protects the draft: the panel behind cannot be
// navigated away, which unmounting it would do silently.
export function FileEditorDialog({ fileName, initialContent, onSave, onSaved, onClose }: FileEditorDialogProps) {
    const { draft, dirty, saving, error, conflict, setDraft, save, overwrite, dismissConflict } = useFileDraft({ initialContent, onSave, onSaved })
    const t = useTranslations('files.editor')
    const [confirmingDiscard, setConfirmingDiscard] = useState(false)

    const requestClose = useCallback(() => {
        if (saving) return
        if (dirty) setConfirmingDiscard(true)
        else onClose()
    }, [dirty, saving, onClose])

    return (
        // A dirty draft is not swipeable away on mobile either: the sheet only closes through the
        // paths that ask first.
        <Dialog open dismissible={!dirty} onOpenChange={open => !open && requestClose()}>
            <DialogContent
                aria-describedby={undefined}
                className="flex h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
                // Radix focuses the content wrapper on open, which would undo the editor's autofocus.
                onOpenAutoFocus={event => event.preventDefault()}
            >
                <DialogHeaderBar
                    icon={FileTextIcon}
                    title={fileName}
                    actions={
                        dirty && (
                            <Badge size="xs" tone="orange" glow={false}>
                                {t('unsaved')}
                            </Badge>
                        )
                    }
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                    <FileTextEditor value={draft} onChange={setDraft} fileName={fileName} readOnly={saving} autoFocus onSave={save} />
                </div>
                {error && <p className="shrink-0 border-t border-border px-4 pt-2 text-xs text-destructive">{error}</p>}
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <Button size="sm" variant="outline" onClick={requestClose} disabled={saving}>
                        {t('cancel')}
                    </Button>
                    <TooltipDisabledReason reason={dirty ? undefined : t('noChanges')}>
                        <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
                            {t('save')}
                        </Button>
                    </TooltipDisabledReason>
                </div>
            </DialogContent>
            {conflict && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && dismissConflict()}
                    title={t('conflictTitle', { name: fileName })}
                    description={t('conflictDescription')}
                    confirmLabel={t('overwrite')}
                    cancelLabel={t('keepTheirs')}
                    onConfirm={overwrite}
                />
            )}
            {confirmingDiscard && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && setConfirmingDiscard(false)}
                    title={t('discardTitle')}
                    description={t('discardDescription', { name: fileName })}
                    confirmLabel={t('discard')}
                    cancelLabel={t('keepEditing')}
                    onConfirm={() => {
                        setConfirmingDiscard(false)
                        onClose()
                    }}
                />
            )}
        </Dialog>
    )
}
