'use client'

import { Button } from '../primitives'
import { Textarea } from '../forms'
import { useKitTranslations } from '../locale'

export type DeclineReasonFormProps = {
    note: string
    onNoteChange: (note: string) => void
    onBack: () => void
    onConfirm: () => void
    disabled?: boolean
    placeholder?: string
}

// The step a refusal goes through so the coworker learns why, not only that the user said no.
export function DeclineReasonForm({ note, onNoteChange, onBack, onConfirm, disabled, placeholder }: DeclineReasonFormProps) {
    const t = useKitTranslations()
    return (
        <div className="space-y-2">
            <Textarea
                autoFocus
                value={note}
                onChange={e => onNoteChange(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        onConfirm()
                    }
                }}
                placeholder={placeholder ?? t('chat.decline.placeholder')}
                disabled={disabled}
                className="min-h-16 text-sm"
            />
            <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={disabled} onClick={onBack} data-hitl="back">
                    {t('chat.decline.back')}
                </Button>
                <Button size="sm" variant="destructive" disabled={disabled} onClick={onConfirm} data-hitl="confirm-decline">
                    {t('chat.decline.confirm')}
                </Button>
            </div>
        </div>
    )
}
