'use client'

import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { OptionWithDescription } from '@/components/dialogs/AccessLevelOption'
import { CopyLine } from '@/components/dialogs/CopyLine'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useErrorText } from '@/hooks/useErrorText'
import { UsersIcon } from '@/lib/icons'

import { isEmail } from './input'
import type { ConsoleResult, InviteAnswer, PersonRole } from './types'

export type InviteRole<Role extends PersonRole> = { value: Role; description: string }

type InviteDialogProps<Role extends PersonRole> = {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    // The first one is picked when the dialog opens.
    roles: InviteRole<Role>[]
    onInvite: (email: string, role: Role) => Promise<ConsoleResult<InviteAnswer>>
}

export function InviteDialog<Role extends PersonRole>({ open, onOpenChange, ...form }: InviteDialogProps<Role>) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">{open && <InviteForm {...form} onClose={() => onOpenChange(false)} />}</DialogContent>
        </Dialog>
    )
}

function InviteForm<Role extends PersonRole>({ title, roles, onInvite, onClose }: Omit<InviteDialogProps<Role>, 'open' | 'onOpenChange'> & { onClose: () => void }) {
    const t = useTranslations('organization.invite')
    const tRoles = useTranslations('organization.roles')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const [draft, setDraft] = useState('')
    const [role, setRole] = useState<Role>(roles[0].value)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [inviteUrl, setInviteUrl] = useState<string | null>(null)
    const email = draft.trim().toLowerCase()

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!isEmail(email) || sending) return
        setSending(true)
        setError(null)
        const result = await onInvite(email, role)
        setSending(false)
        if (!result.ok) return setError(errorText(result))
        if (result.inviteUrl) setInviteUrl(result.inviteUrl)
        else onClose()
    }

    if (inviteUrl)
        return (
            <>
                <DialogHeaderBar icon={UsersIcon} title={title} description={t('linkHint', { email })} />
                <CopyLine value={inviteUrl} label={t('copyLink')} />
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('done')}
                    </Button>
                </DialogFooter>
            </>
        )

    return (
        <form onSubmit={submit} className="contents">
            <DialogHeaderBar icon={UsersIcon} title={title} description={t('description')} />
            <div className="space-y-4">
                <Field label={t('email')} htmlFor="invite-email" error={error ?? undefined}>
                    <Input id="invite-email" type="email" autoFocus required placeholder={t('emailPlaceholder')} value={draft} onChange={event => setDraft(event.target.value)} />
                </Field>
                <Field label={t('role')} htmlFor="invite-role">
                    <Select value={role} onValueChange={value => setRole(value as Role)}>
                        <SelectTrigger id="invite-role" className="w-full data-[size=default]:h-10">
                            <SelectValue>{tRoles(role as PersonRole)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper" className="w-(--radix-select-trigger-width)">
                            {roles.map(({ value, description }) => (
                                <SelectItem key={value} value={value}>
                                    <OptionWithDescription label={tRoles(value as PersonRole)} description={description} />
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                    {tCommon('cancel')}
                </Button>
                <Button type="submit" loading={sending} disabled={!isEmail(email)}>
                    {t('submit')}
                </Button>
            </DialogFooter>
        </form>
    )
}
