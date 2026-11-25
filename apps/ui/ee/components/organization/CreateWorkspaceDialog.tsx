'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState, type FormEvent } from 'react'

import { CopyLine } from '@/components/dialogs/CopyLine'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import { useErrorText } from '@/hooks/useErrorText'
import { LayersIcon, MailCheckIcon, UploadIcon } from '@/lib/icons'
import { WORKSPACE_NAME_MAX } from '@/lib/naming/workspace-name'
import { LOGO_ACCEPT, LOGO_MAX_BYTES } from '@/lib/workspace/logo-input'

import { isEmail } from './input'
import type { ConsoleResult, InviteAnswer } from './types'
import { useHeldDialog, type Hold } from './useHeldDialog'

export type NewWorkspace = { name: string; adminEmail: string; logo: File | null }

type CreateWorkspaceDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreate: (workspace: NewWorkspace) => Promise<ConsoleResult<InviteAnswer & { workspaceId: number }>>
    onView: (workspaceId: number) => void
}

export function CreateWorkspaceDialog({ open, onOpenChange, onCreate, onView }: CreateWorkspaceDialogProps) {
    const dialog = useHeldDialog(onOpenChange)
    return (
        <Dialog open={open} onOpenChange={dialog.onOpenChange}>
            <DialogContent className="sm:max-w-md">{open && <CreateWorkspaceForm onCreate={onCreate} hold={dialog.hold} onClose={dialog.close} onView={onView} />}</DialogContent>
        </Dialog>
    )
}

function CreateWorkspaceForm({ onCreate, hold, onClose, onView }: Pick<CreateWorkspaceDialogProps, 'onCreate' | 'onView'> & { hold: Hold; onClose: () => void }) {
    const t = useTranslations('organization.create')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [emailLeft, setEmailLeft] = useState(false)
    const [logo, setLogo] = useState<{ file: File; url: string } | null>(null)
    const [logoTooLarge, setLogoTooLarge] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [created, setCreated] = useState<(InviteAnswer & { workspaceId: number }) | null>(null)

    const logoUrl = logo?.url
    useEffect(() => () => void (logoUrl && URL.revokeObjectURL(logoUrl)), [logoUrl])

    const adminEmail = email.trim().toLowerCase()
    const nameTooLong = name.trim().length > WORKSPACE_NAME_MAX
    const ready = !!name.trim() && !nameTooLong && isEmail(adminEmail)

    const pickLogo = (file: File) => {
        const tooLarge = file.size > LOGO_MAX_BYTES
        setLogoTooLarge(tooLarge)
        if (!tooLarge) setLogo({ file, url: URL.createObjectURL(file) })
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!ready || creating) return
        setCreating(true)
        setError(null)
        const result = await hold(() => onCreate({ name: name.trim(), adminEmail, logo: logo?.file ?? null }))
        setCreating(false)
        if (result.ok) setCreated(result)
        else setError(errorText(result))
    }

    if (created) {
        const { workspaceId, inviteUrl } = created
        return (
            <>
                <DialogHeaderBar icon={MailCheckIcon} title={t('done.title', { name: name.trim() })} description={t(inviteUrl ? 'done.linkHint' : 'done.description', { email: adminEmail })} />
                {inviteUrl && <CopyLine value={inviteUrl} label={t('done.copyLink')} />}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('done.close')}
                    </Button>
                    <Button onClick={() => onView(workspaceId)}>{t('done.open')}</Button>
                </DialogFooter>
            </>
        )
    }

    return (
        <form onSubmit={submit} className="contents">
            <DialogHeaderBar icon={LayersIcon} title={t('title')} description={t('description')} />
            <div className="space-y-4">
                <div className="flex items-end gap-4">
                    <FileDropzone onFiles={files => pickLogo(files[0])} accept={LOGO_ACCEPT} overlayLabel="" className="shrink-0">
                        {({ inputId }) => (
                            <label htmlFor={inputId} aria-label={t('logo')} className="group relative block size-16 cursor-pointer">
                                {logo ? <img src={logo.url} alt="" className="size-full rounded-2xl bg-muted object-cover" /> : <span className="block size-full rounded-2xl bg-muted" />}
                                <span className="absolute -end-1 -bottom-1 flex size-6 items-center justify-center rounded-full border bg-background shadow-sm transition-colors group-hover:bg-muted">
                                    <UploadIcon className="size-3.5" />
                                </span>
                            </label>
                        )}
                    </FileDropzone>
                    <div className="min-w-0 flex-1">
                        <Field label={t('name')} htmlFor="new-workspace-name" error={nameTooLong ? t('nameTooLong', { max: WORKSPACE_NAME_MAX }) : undefined}>
                            <Input id="new-workspace-name" autoFocus required placeholder={t('namePlaceholder')} value={name} onChange={event => setName(event.target.value)} />
                        </Field>
                    </div>
                </div>
                {logoTooLarge && <p className="text-xs text-destructive">{t('logoTooLarge')}</p>}
                <Field label={t('email')} htmlFor="new-workspace-email" error={emailLeft && email && !isEmail(adminEmail) ? t('emailInvalid') : undefined}>
                    <Input id="new-workspace-email" type="email" required placeholder={t('emailPlaceholder')} value={email} onBlur={() => setEmailLeft(true)} onChange={event => setEmail(event.target.value)} />
                </Field>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" disabled={creating} onClick={onClose}>
                    {tCommon('cancel')}
                </Button>
                <Button type="submit" loading={creating} disabled={!ready}>
                    {t('submit')}
                </Button>
            </DialogFooter>
        </form>
    )
}
