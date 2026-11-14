'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Loader2Icon, FileTextIcon } from '@/lib/icons'
import { RichTextEditor } from '@rerun/ui/rich-text-editor'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState, type ReactNode } from 'react'

type MarkdownEditorDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialValue: string
    title: string
    description?: string
    hint?: string
    closeLabel?: string
    submitLabel?: string
    submitIcon?: ReactNode
    submitting?: boolean
    onClose: (markdown: string) => void
    onSubmit?: (markdown: string) => void
}

/**
 * Long-form markdown editor. The caller remounts it with a fresh `key` on every open, so the
 * initial value is read once at mount and no reset effect is needed.
 */
export function MarkdownEditorDialog({
    open,
    onOpenChange,
    initialValue,
    title,
    description,
    hint,
    closeLabel,
    submitLabel,
    submitIcon,
    submitting,
    onClose,
    onSubmit,
}: MarkdownEditorDialogProps) {
    const t = useTranslations('ui.markdown')
    const [markdown, setMarkdown] = useState(initialValue)
    // TipTap normalizes whatever text it is given, so the first markdown it emits is the untouched
    // baseline. Comparing against it lets us hand back the original text when nothing was edited,
    // rather than a round-tripped version with re-escaped characters and merged soft breaks.
    const baselineRef = useRef<string | null>(null)

    const resolve = useCallback(() => (baselineRef.current !== null && markdown === baselineRef.current ? initialValue : markdown), [markdown, initialValue])

    const handleChange = useCallback((next: string) => {
        if (baselineRef.current === null) baselineRef.current = next
        setMarkdown(next)
    }, [])

    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (!next) onClose(resolve())
            onOpenChange(next)
        },
        [onClose, onOpenChange, resolve]
    )

    const handleSubmit = useCallback(() => {
        if (!onSubmit) return
        const text = resolve()
        if (!text.trim() || submitting) return
        onSubmit(text)
    }, [resolve, submitting, onSubmit])

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {/* Radix focuses the content wrapper on open, which would undo the editor's autofocus. */}
            <DialogContent className="sm:max-w-3xl" onOpenAutoFocus={e => e.preventDefault()}>
                <DialogHeaderBar icon={FileTextIcon} title={title} description={description} />
                <RichTextEditor
                    autoFocus
                    contentClassName="max-h-[60vh] min-h-[35vh] overflow-y-auto sm:min-h-[45vh]"
                    value={markdown}
                    onChange={handleChange}
                    onSubmitShortcut={onSubmit ? handleSubmit : undefined}
                />
                <DialogFooter className="sm:items-center">
                    {hint && <span className="hidden text-xs text-muted-foreground sm:mr-auto sm:inline">{hint}</span>}
                    <Button type="button" variant={submitLabel ? 'outline' : 'default'} onClick={() => handleOpenChange(false)}>
                        {closeLabel ?? t('done')}
                    </Button>
                    {submitLabel && (
                        <Button type="button" onClick={handleSubmit} disabled={!markdown.trim() || submitting}>
                            {submitting ? <Loader2Icon className="size-4 animate-spin" /> : submitIcon}
                            {submitLabel}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
