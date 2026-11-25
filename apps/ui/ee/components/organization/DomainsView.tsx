'use client'

import type { Brand } from '@rerun/contracts'
import { fullDateTime } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { EllipsisIcon, GlobeIcon, PlusIcon, Trash2Icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { BrandScreenPreview } from './BrandScreenPreview'
import { readHostname } from './input'
import { CopyButton, Dot, Page, Section } from './parts'
import type { ConsoleDomain, ConsoleResult, DnsRecord, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'
import { useHeldDialog, type Hold } from './useHeldDialog'

type DomainsViewProps = {
    brand: Brand
    defaultHostname: string
    domains: ConsoleDomain[]
    checkingId: string | null
    block: WriteBlock | null
    onAdd: (hostname: string) => Promise<ConsoleResult>
    onCheck: (domain: ConsoleDomain) => void
    onRemove: (domain: ConsoleDomain) => void
}

// Served and pointing here: nothing left to set up. One that is served and stopped pointing here shows
// what to publish again.
const isSettled = ({ status, error }: ConsoleDomain) => status === 'active' && !error

export function DomainsView({ brand, defaultHostname, domains, checkingId, block, onAdd, onCheck, onRemove }: DomainsViewProps) {
    const t = useTranslations('organization.domains')
    const blockReason = useBlockReason(block)
    const [adding, setAdding] = useState(false)
    const settled = domains.filter(isSettled)
    const [main, ...others] = settled
    const address = main?.hostname ?? defaultHostname
    return (
        <Page>
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-10 lg:grid-cols-2">
                <div className="min-w-0 space-y-10">
                    <header className="space-y-4">
                        <p className="text-sm text-muted-foreground">{t('signInAt')}</p>
                        <h1 className="text-3xl font-medium tracking-tight break-all sm:text-4xl">{address}</h1>
                        <div className="flex flex-wrap items-center gap-2">
                            <TooltipDisabledReason reason={blockReason}>
                                <Button disabled={!!blockReason} onClick={() => setAdding(true)}>
                                    <PlusIcon />
                                    {t('add')}
                                </Button>
                            </TooltipDisabledReason>
                            {main && <DomainMenu domain={main} reason={blockReason} onRemove={() => onRemove(main)} />}
                        </div>
                    </header>
                    {domains
                        .filter(domain => !isSettled(domain))
                        .map(domain => (
                            <DomainSetup key={domain.id} domain={domain} checking={domain.id === checkingId} blockReason={blockReason} onCheck={() => onCheck(domain)} onRemove={() => onRemove(domain)} />
                        ))}
                    <Section title={t(main ? 'alsoAnswers' : 'included')}>
                        {others.map(domain => (
                            <AddressLine key={domain.id} hostname={domain.hostname}>
                                <DomainMenu domain={domain} reason={blockReason} onRemove={() => onRemove(domain)} />
                            </AddressLine>
                        ))}
                        <AddressLine hostname={defaultHostname} />
                    </Section>
                </div>
                <BrandScreenPreview surface="auth" brand={brand} address={address} width={860} className="max-lg:hidden lg:sticky lg:top-10" frameClassName="aspect-[1.15]" />
            </div>
            <AddDomainDialog open={adding} onOpenChange={setAdding} onAdd={onAdd} />
        </Page>
    )
}

function AddressLine({ hostname, children }: { hostname: string; children?: ReactNode }) {
    const t = useTranslations('organization.domains')
    return (
        <div className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-sm">{hostname}</span>
            <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <Dot tone="green" />
                {t('status.active')}
            </span>
            <CopyButton value={`https://${hostname}`} label={t('copyAddress')} />
            {children}
        </div>
    )
}

function DomainMenu({ domain: { hostname }, reason, onRemove }: { domain: ConsoleDomain; reason?: string; onRemove: () => void }) {
    const t = useTranslations('organization.domains')
    const [confirming, setConfirming] = useState(false)
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t('more', { hostname })} className="shrink-0 text-muted-foreground">
                        <EllipsisIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                    <TooltipDisabledReason reason={reason} side="left" className="flex w-full">
                        <DropdownMenuItem variant="destructive" disabled={!!reason} onSelect={() => setConfirming(true)} className="w-full">
                            <Trash2Icon />
                            {t('remove')}
                        </DropdownMenuItem>
                    </TooltipDisabledReason>
                </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t('removeConfirm.title', { hostname })} description={t('removeConfirm.description')} confirmLabel={t('removeConfirm.confirm')} onConfirm={onRemove} />
        </>
    )
}

function DomainSetup({ domain, checking, blockReason, onCheck, onRemove }: { domain: ConsoleDomain; checking: boolean; blockReason?: string; onCheck: () => void; onRemove: () => void }) {
    const t = useTranslations('organization.domains')
    const locale = useLocale()
    const { hostname, status, error, records, lastCheckedAt } = domain
    const steps = ['records', 'seen', 'https'] as const
    return (
        <Section
            title={t(status === 'pending' ? 'moving' : 'lost', { hostname })}
            actions={
                <>
                    <TooltipDisabledReason reason={blockReason}>
                        <Button variant="outline" size="sm" disabled={!!blockReason} loading={checking} onClick={onCheck}>
                            {t('check')}
                        </Button>
                    </TooltipDisabledReason>
                    <DomainMenu domain={domain} reason={blockReason} onRemove={onRemove} />
                </>
            }
        >
            {error && (
                <p className="flex items-center gap-2 border-b border-border py-3 text-sm">
                    <Dot tone={status === 'pending' ? 'amber' : 'red'} />
                    <span className="min-w-0 break-words">{error}</span>
                </p>
            )}
            <ol>
                {steps.map((step, index) => (
                    <li key={step} className="space-y-3 border-b border-border py-3">
                        <p className={cn('flex items-center gap-3 text-sm', index === 0 ? 'font-medium' : 'text-muted-foreground')}>
                            <span className="flex w-5 shrink-0 justify-center tabular-nums">{index === 0 ? <Spinner className="size-4" /> : index + 1}</span>
                            {t(`steps.${step}`)}
                        </p>
                        {index === 0 && records.map(record => <DnsRecordFields key={`${record.type} ${record.name}`} record={record} />)}
                    </li>
                ))}
            </ol>
            {lastCheckedAt && <p className="pt-2 text-xs text-muted-foreground">{t('checkedAt', { time: fullDateTime(lastCheckedAt, locale) })}</p>}
        </Section>
    )
}

function DnsRecordFields({ record }: { record: DnsRecord }) {
    const t = useTranslations('organization.domains.record')
    const cells = [
        { label: t('type'), value: record.type, copy: null },
        { label: t('name'), value: record.name, copy: t('copyName') },
        { label: t('value'), value: record.value, copy: t('copyValue') },
    ]
    return (
        <dl className="grid grid-cols-[minmax(0,1fr)] rounded-lg bg-muted/60 max-sm:divide-y max-sm:divide-border sm:grid-cols-[5.5rem_minmax(0,0.8fr)_minmax(0,1fr)]">
            {cells.map(({ label, value, copy }) => (
                <div key={label} className="flex min-w-0 items-center gap-1 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="truncate font-mono text-sm" title={value}>
                            {value}
                        </dd>
                    </div>
                    {copy && <CopyButton value={value} label={copy} />}
                </div>
            ))}
        </dl>
    )
}

function AddDomainDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: DomainsViewProps['onAdd'] }) {
    const dialog = useHeldDialog(onOpenChange)
    return (
        <Dialog open={open} onOpenChange={dialog.onOpenChange}>
            <DialogContent className="sm:max-w-md">{open && <AddDomainForm onAdd={onAdd} hold={dialog.hold} onClose={dialog.close} />}</DialogContent>
        </Dialog>
    )
}

function AddDomainForm({ onAdd, hold, onClose }: { onAdd: DomainsViewProps['onAdd']; hold: Hold; onClose: () => void }) {
    const t = useTranslations('organization.domains.dialog')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const [typed, setTyped] = useState('')
    const [left, setLeft] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { hostname, problem } = readHostname(typed)
    const problemText = problem && left && typed ? t(problem, { hostname }) : undefined

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        setLeft(true)
        if (problem || sending) return
        setSending(true)
        setError(null)
        const result = await hold(() => onAdd(hostname))
        setSending(false)
        if (result.ok) onClose()
        else setError(errorText(result))
    }

    return (
        <form onSubmit={submit} className="contents">
            <DialogHeaderBar icon={GlobeIcon} title={t('title')} description={t('description')} />
            <Field label={t('hostname')} htmlFor="organization-hostname" error={error ?? problemText}>
                <Input id="organization-hostname" autoFocus autoCapitalize="none" autoComplete="off" spellCheck={false} inputMode="url" placeholder="app.acme.com" value={typed} aria-invalid={!!problemText || undefined} onBlur={() => setLeft(true)} onChange={event => (setTyped(event.target.value), setError(null))} />
            </Field>
            <DialogFooter>
                <Button type="button" variant="outline" disabled={sending} onClick={onClose}>
                    {tCommon('cancel')}
                </Button>
                <Button type="submit" loading={sending} disabled={!typed.trim() || (left && !!problem)}>
                    {t('submit')}
                </Button>
            </DialogFooter>
        </form>
    )
}

export function DomainsSkeleton() {
    const t = useTranslations('organization.domains')
    return (
        <Page>
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-10 lg:grid-cols-2">
                <div className="min-w-0 space-y-10">
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">{t('signInAt')}</p>
                        <Skeleton className="h-10 w-72 max-w-full" />
                        <Skeleton className="h-9 w-36 rounded-lg" />
                    </div>
                    <Section title={t('included')}>
                        <div className="py-3">
                            <Skeleton className="h-4 w-40" />
                        </div>
                    </Section>
                </div>
                <Skeleton className="aspect-[1.1] w-full rounded-xl max-lg:hidden" />
            </div>
        </Page>
    )
}
