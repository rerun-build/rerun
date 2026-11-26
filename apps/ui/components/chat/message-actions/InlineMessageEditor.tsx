'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

// The bubble of the message turned into a field. Enter sends, Shift+Enter starts a new line, Escape
// gives up.
export function InlineMessageEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
    const t = useTranslations('chat.messageActions')
    const [value, setValue] = useState(initial)
    const unchanged = !value.trim() || value.trim() === initial.trim()
    const save = () => {
        if (!unchanged) onSave(value)
    }
    return (
        <div data-message-editor="" className="ms-auto flex w-full max-w-[95%] flex-col gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm ring-2 ring-ring/20">
            <textarea
                autoFocus
                value={value}
                aria-label={t('edit')}
                onChange={event => setValue(event.target.value)}
                onFocus={event => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        onCancel()
                    }
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        save()
                    }
                }}
                className="field-sizing-content max-h-60 min-h-10 w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
                <p className="me-auto px-1.5 text-muted-foreground text-xs">{t('editHint')}</p>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    {t('cancel')}
                </Button>
                <Button size="sm" onClick={save} disabled={unchanged}>
                    {t('send')}
                </Button>
            </div>
        </div>
    )
}
