'use client'

import type { Brand } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { ScrollFade } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { CopyLine } from '@/components/dialogs/CopyLine'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CONSOLE_HOME, consoleWorkspacePath } from '@/ee/lib/organizations/console-routes'
import { nameInvitation } from '@/ee/lib/organizations/invitation-preview'
import type { CreatedWorkspace, StartingCredit } from '@/ee/services/organization-workspaces.service'
import { useErrorText } from '@/hooks/useErrorText'
import { UploadIcon, XIcon } from '@/lib/icons'
import { WORKSPACE_NAME_MAX } from '@/lib/naming/workspace-name'
import { randomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import { LOGO_ACCEPT, LOGO_MAX_BYTES } from '@/lib/workspace/logo-input'

import { Browser, ScaledFrame } from './Browser'
import { isEmail, wholeCredits } from './input'
import { SquareLogo } from './SquareLogo'
import type { ConsoleResult, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

export type NewWorkspace = { name: string; adminEmail: string; logo: File | null; starting: StartingCredit | null }

const FORM_ID = 'new-workspace'
const AMOUNTS = [0, 250, 500, 1000]
const EMAIL_WIDTH = 680

type NewWorkspaceViewProps = {
    brand: Brand
    // The invitation, its workspace still to be named.
    email: string
    reserveMicros: number
    limitReached: number | null
    block: WriteBlock | null
    onCreate: (workspace: NewWorkspace) => Promise<ConsoleResult<CreatedWorkspace>>
}

export function NewWorkspaceView({ brand, email: invitation, reserveMicros, limitReached, block, onCreate }: NewWorkspaceViewProps) {
    const t = useTranslations('organization.create')
    const tWorkspaces = useTranslations('organization.workspaces')
    const errorText = useErrorText()
    const blockReason = useBlockReason(block)
    const reserve = wholeCredits(reserveMicros)
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [emailLeft, setEmailLeft] = useState(false)
    const [logo, setLogo] = useState<{ file: File; url: string } | null>(null)
    const [logoTooLarge, setLogoTooLarge] = useState(false)
    const [picked, setPicked] = useState<number | null>(null)
    const [requestId] = useState(() => randomUuid())
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const creatingNow = useRef(false)
    const [created, setCreated] = useState<CreatedWorkspace | null>(null)

    const logoUrl = logo?.url
    useEffect(() => () => void (logoUrl && URL.revokeObjectURL(logoUrl)), [logoUrl])

    const credits = picked ?? (reserve >= 500 ? 500 : 0)
    const adminEmail = email.trim().toLowerCase()
    const nameTooLong = name.trim().length > WORKSPACE_NAME_MAX
    const ready = !!name.trim() && !nameTooLong && isEmail(adminEmail)
    const reason = blockReason ?? (limitReached === null ? undefined : tWorkspaces('limitReached', { max: limitReached }))

    const pickLogo = (file: File) => {
        const tooLarge = file.size > LOGO_MAX_BYTES
        setLogoTooLarge(tooLarge)
        if (!tooLarge) setLogo({ file, url: URL.createObjectURL(file) })
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!ready || reason || creatingNow.current) return
        creatingNow.current = true
        setCreating(true)
        setError(null)
        const result = await onCreate({ name: name.trim(), adminEmail, logo: logo?.file ?? null, starting: credits > 0 ? { credits, requestId } : null })
        creatingNow.current = false
        setCreating(false)
        if (result.ok) setCreated(result)
        else setError(errorText(result))
    }

    const shownName = useDeferredValue(name.trim()) || t('namePlaceholder')
    const html = useMemo(() => nameInvitation(invitation, shownName), [invitation, shownName])

    return (
        <div className="flex h-dvh flex-col bg-card text-foreground">
            <header className="shrink-0 border-b border-border pt-[env(safe-area-inset-top)]">
                <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
                    <Link href={CONSOLE_HOME} aria-label={t('close')} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
                        <XIcon />
                    </Link>
                    <SquareLogo name={brand.name} iconUrl={brand.iconUrl} className="size-6 rounded-md" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{t('title')}</p>
                    {created ? (
                        <Link href={consoleWorkspacePath(created.workspaceId)} className={buttonVariants()}>
                            {t('done.open')}
                        </Link>
                    ) : (
                        <TooltipDisabledReason reason={reason}>
                            <Button type="submit" form={FORM_ID} loading={creating} disabled={!ready || !!reason}>
                                {t('submit')}
                            </Button>
                        </TooltipDisabledReason>
                    )}
                </div>
            </header>
            <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                <ScrollFade className="min-h-0">
                    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-14">
                        {created ? (
                            <Done created={created} name={name.trim()} email={adminEmail} />
                        ) : (
                            <form id={FORM_ID} onSubmit={submit} className="space-y-6">
                                <h1 className="text-3xl font-medium tracking-tight text-balance">{t('question')}</h1>
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
                                <StartingCreditField credits={credits} reserve={reserve} onPick={setPicked} />
                                {error && <p className="text-sm text-destructive">{error}</p>}
                            </form>
                        )}
                    </div>
                </ScrollFade>
                <div className="hidden min-h-0 flex-col bg-muted/60 p-8 lg:flex xl:p-12">
                    <Browser address={t('mailTo', { email: adminEmail || t('emailPlaceholder') })} className="mx-auto w-full max-w-xl flex-1">
                        <ScaledFrame title={t('mailTitle')} srcDoc={html} sandbox="" width={EMAIL_WIDTH} className="min-h-0 flex-1" />
                    </Browser>
                </div>
            </main>
        </div>
    )
}

function StartingCreditField({ credits, reserve, onPick }: { credits: number; reserve: number; onPick: (credits: number) => void }) {
    const t = useTranslations('organization.create')
    const tCredit = useTranslations('organization.credit')
    const locale = useLocale()
    return (
        <Field label={t('credit')} helperText={tCredit('leftInReserve', { amount: formatNumber(Math.max(reserve - credits, 0), locale) })}>
            <div role="group" aria-label={t('credit')} className="grid grid-cols-4 overflow-hidden rounded-lg border border-input">
                {AMOUNTS.map(amount => {
                    const picked = amount === credits
                    return (
                        <TooltipDisabledReason key={amount} reason={amount > reserve ? tCredit('dialog.tooMuchReserve', { count: reserve }) : undefined} className="flex rounded-none border-s border-input first:border-s-0">
                            <button
                                type="button"
                                aria-pressed={picked}
                                disabled={amount > reserve}
                                onClick={() => onPick(amount)}
                                className={cn('h-10 w-full text-sm tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40', amount > 0 && amount <= reserve && 'border-s border-input', picked ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                            >
                                {amount === 0 ? t('noCredit') : formatNumber(amount, locale)}
                            </button>
                        </TooltipDisabledReason>
                    )
                })}
            </div>
        </Field>
    )
}

function Done({ created: { inviteUrl, creditFailed }, name, email }: { created: CreatedWorkspace; name: string; email: string }) {
    const t = useTranslations('organization.create')
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-medium tracking-tight text-balance break-words">{t('done.title', { name })}</h1>
            <p className="text-sm break-words text-muted-foreground">{t(inviteUrl ? 'done.description' : 'done.sent', { email })}</p>
            {inviteUrl && <CopyLine value={inviteUrl} label={t('done.copyLink')} />}
            {creditFailed && <p className="text-sm text-destructive">{t('done.creditFailed')}</p>}
        </div>
    )
}

export function NewWorkspaceSkeleton() {
    const t = useTranslations('organization.create')
    return (
        <div className="flex h-dvh flex-col bg-card text-foreground">
            <header className="shrink-0 border-b border-border pt-[env(safe-area-inset-top)]">
                <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
                    <Link href={CONSOLE_HOME} aria-label={t('close')} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
                        <XIcon />
                    </Link>
                    <Skeleton className="size-6 rounded-md" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{t('title')}</p>
                    <Skeleton className="h-9 w-32 rounded-lg" />
                </div>
            </header>
            <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                <div className="min-h-0 overflow-hidden">
                    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-8 sm:py-14">
                        <h1 className="text-3xl font-medium tracking-tight text-balance">{t('question')}</h1>
                        <div className="flex items-end gap-4">
                            <Skeleton className="size-16 shrink-0 rounded-2xl" />
                            <div className="min-w-0 flex-1">
                                <Field label={t('name')}>
                                    <Skeleton className="h-10 w-full rounded-lg" />
                                </Field>
                            </div>
                        </div>
                        <Field label={t('email')}>
                            <Skeleton className="h-10 w-full rounded-lg" />
                        </Field>
                        <Field label={t('credit')}>
                            <Skeleton className="h-10 w-full rounded-lg" />
                        </Field>
                    </div>
                </div>
                <div className="hidden min-h-0 flex-col bg-muted/60 p-8 lg:flex xl:p-12">
                    <Skeleton className="mx-auto w-full max-w-xl flex-1 rounded-xl" />
                </div>
            </main>
        </div>
    )
}
