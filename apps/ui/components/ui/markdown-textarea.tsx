'use client'

import { Field } from '@/components/ui/field'
import { MarkdownEditorDialog } from '@/components/ui/markdown-editor-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Maximize2Icon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useCallback, useId, useState, type ComponentProps } from 'react'

type MarkdownTextareaProps = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
    value: string
    onChange: (value: string) => void
    label?: string
    optional?: boolean
    hideRequired?: boolean
    helperText?: string
    dialogTitle: string
    dialogDescription?: string
}

/**
 * Textarea with an affordance to open the same long-form markdown editor as the chat composer.
 * `onChange` always receives the text, never an event, so it plugs straight into a `useState`
 * setter or a react-hook-form `field.onChange`.
 */
export function MarkdownTextarea({
    value,
    onChange,
    label,
    optional,
    hideRequired,
    helperText,
    dialogTitle,
    dialogDescription,
    className,
    id,
    disabled,
    ...props
}: MarkdownTextareaProps) {
    const t = useTranslations('ui.markdown')
    const generatedId = useId()
    const textareaId = id ?? generatedId

    const [open, setOpen] = useState(false)
    const [session, setSession] = useState(0)
    const [initial, setInitial] = useState('')

    const handleExpand = useCallback(() => {
        setInitial(value)
        setSession(current => current + 1)
        setOpen(true)
    }, [value])

    return (
        <Field label={label} optional={optional} hideRequired={hideRequired} helperText={helperText} htmlFor={textareaId}>
            <div className="relative">
                <Textarea id={textareaId} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={cn('pr-9', className)} {...props} />
                {!disabled && (
                    <button
                        type="button"
                        onClick={handleExpand}
                        aria-label={t('openEditor')}
                        title={t('openEditor')}
                        className="absolute top-1.5 right-1.5 z-10 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                    >
                        <Maximize2Icon className="size-3.5" />
                    </button>
                )}
            </div>
            <MarkdownEditorDialog
                key={session}
                open={open}
                onOpenChange={setOpen}
                initialValue={initial}
                title={dialogTitle}
                description={dialogDescription}
                onClose={onChange}
            />
        </Field>
    )
}
