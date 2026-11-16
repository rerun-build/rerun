'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { XIcon } from '@/lib/icons'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** An address as it is kept: trimmed, lower case, or `null` when it is not one. */
export function inviteEmail(raw: string): string | null {
    const email = raw.trim().toLowerCase()
    return EMAIL_RE.test(email) ? email : null
}

// The addresses to invite, typed one at a time: Enter or Add puts it in the list, a duplicate is
// refused, and `max` stops the field once the list is full. Shared by the workspace creation and the
// onboarding.
export function InviteEmailsField({ emails, onChange, max, helperText, autoFocus }: { emails: string[]; onChange: (emails: string[]) => void; max?: number; helperText?: string; autoFocus?: boolean }) {
    const t = useTranslations('dialogs.createWorkspace')
    const id = useId()
    const [draft, setDraft] = useState('')
    const email = inviteEmail(draft)
    const full = max !== undefined && emails.length >= max
    const addable = !!email && !emails.includes(email) && !full

    const add = () => {
        if (!addable) return
        onChange([...emails, email])
        setDraft('')
    }

    return (
        <div className="space-y-4">
            <Field label={t('email')} helperText={helperText} htmlFor={id}>
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <Input
                            id={id}
                            type="email"
                            placeholder={t('emailPlaceholder')}
                            autoFocus={autoFocus}
                            disabled={full}
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            onKeyDown={event => {
                                if (event.key !== 'Enter') return
                                event.preventDefault()
                                add()
                            }}
                        />
                    </div>
                    <Button type="button" variant="outline" onClick={add} disabled={!addable}>
                        {t('add')}
                    </Button>
                </div>
            </Field>

            {emails.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {emails.map(each => (
                        <li key={each} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-sm">{each}</span>
                            <button type="button" onClick={() => onChange(emails.filter(other => other !== each))} aria-label={t('removeMember', { email: each })} className="text-muted-foreground hover:text-foreground">
                                <XIcon className="size-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
