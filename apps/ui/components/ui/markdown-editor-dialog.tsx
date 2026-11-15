'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2Icon } from '@/lib/icons'
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
            <DialogContent className="sm:max-w-3xl" onOpenAutoFocus={e => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
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
