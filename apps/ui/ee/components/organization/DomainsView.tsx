'use client'

import { fullDateTime } from '@rerun/i18n/format'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { CopyLine } from '@/components/dialogs/CopyLine'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { GlobeIcon, PlusIcon, RotateCwIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { ConsoleGroup, ConsolePage } from './ConsolePage'
import { readHostname } from './input'
import { DOMAIN_STATUS_TONE, type ConsoleDomain, type ConsoleResult, type DnsRecord, type DomainStatus, type WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

type DomainsViewProps = {
    // Null while it is read.
    defaultHostname: string | null
    domains: ConsoleDomain[] | null
    checkingId: string | null
    block: WriteBlock | null
    onAdd: (hostname: string) => Promise<ConsoleResult>
    onCheck: (domain: ConsoleDomain) => void
    onRemove: (domain: ConsoleDomain) => void
}

export function DomainsView({ defaultHostname, domains, checkingId, block, onAdd, onCheck, onRemove }: DomainsViewProps) {
    const t = useTranslations('organization.domains')
    const blockReason = useBlockReason(block)
    const [adding, setAdding] = useState(false)
    return (
        <ConsolePage
            title={t('title')}
            description={t('description')}
            actions={
                <TooltipDisabledReason reason={blockReason}>
                    <Button disabled={!domains || !!blockReason} onClick={() => setAdding(true)}>
                        <PlusIcon />
                        {t('add')}
                    </Button>
                </TooltipDisabledReason>
            }
        >
            <ConsoleGroup title={t('default')}>
                <div className={cn('flex items-center gap-3 p-4', PANEL_CARD)}>
                    {defaultHostname === null ? <Skeleton className="h-8 flex-1" /> : <CopyLine value={`https://${defaultHostname}`} label={t('copyAddress')} className="flex-1" />}
                    <DomainStatusBadge status="active" />
                </div>
            </ConsoleGroup>
            <ConsoleGroup title={t('custom')}>
                {!domains ? (
                    <DomainSkeleton />
                ) : domains.length === 0 ? (
                    <EmptyState icon={GlobeIcon} title={t('empty.title')} description={t('empty.description')} className="py-12" />
                ) : (
                    <div className="space-y-3">
                        {domains.map(domain => (
                            <DomainCard key={domain.id} domain={domain} checking={domain.id === checkingId} blockReason={blockReason} onCheck={() => onCheck(domain)} onRemove={() => onRemove(domain)} />
                        ))}
                    </div>
                )}
            </ConsoleGroup>
            <AddDomainDialog open={adding} onOpenChange={setAdding} onAdd={onAdd} />
        </ConsolePage>
    )
}

function DomainStatusBadge({ status }: { status: DomainStatus }) {
    const t = useTranslations('organization.domains.status')
    return (
        <Badge size="xs" tone={DOMAIN_STATUS_TONE[status]} glow={false} className="shrink-0 font-medium">
            {t(status)}
        </Badge>
    )
}

function DomainCard({ domain, checking, blockReason, onCheck, onRemove }: { domain: ConsoleDomain; checking: boolean; blockReason?: string; onCheck: () => void; onRemove: () => void }) {
    const t = useTranslations('organization.domains')
    const locale = useLocale()
    const [confirming, setConfirming] = useState(false)
    const { hostname, status, error, records, lastCheckedAt } = domain
    const live = status === 'active'
    return (
        <div className={cn('space-y-4 p-4', PANEL_CARD)}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium break-all">{hostname}</p>
                    {lastCheckedAt && !live && <p className="text-xs text-muted-foreground">{t('checkedAt', { time: fullDateTime(lastCheckedAt, locale) })}</p>}
                </div>
                <DomainStatusBadge status={status} />
            </div>
            {error && <p className="text-sm break-words text-destructive">{error}</p>}
            {!live && records.length > 0 && (
                <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">{t('record.hint')}</p>
                    {records.map(record => (
                        <DnsRecordFields key={`${record.type} ${record.name}`} record={record} />
                    ))}
                </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
                <TooltipDisabledReason reason={blockReason}>
                    <Button variant="ghost" disabled={!!blockReason} className="text-muted-foreground" onClick={() => setConfirming(true)}>
                        {t('remove')}
                    </Button>
                </TooltipDisabledReason>
                {!live && (
                    <TooltipDisabledReason reason={blockReason}>
                        <Button variant="outline" disabled={!!blockReason} loading={checking || status === 'verifying'} onClick={onCheck}>
                            <RotateCwIcon />
                            {t('check')}
                        </Button>
                    </TooltipDisabledReason>
                )}
            </div>
            <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t('removeConfirm.title', { hostname })} description={t('removeConfirm.description')} confirmLabel={t('removeConfirm.confirm')} onConfirm={onRemove} />
        </div>
    )
}

function DnsRecordFields({ record }: { record: DnsRecord }) {
    const t = useTranslations('organization.domains.record')
    return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label={t('type')}>
                <span className="font-mono text-xs leading-8">{record.type}</span>
            </Field>
            <Field label={t('name')}>
                <CopyLine value={record.name} label={t('copyName')} />
            </Field>
            <Field label={t('value')}>
                <CopyLine value={record.value} label={t('copyValue')} />
            </Field>
        </div>
    )
}

function AddDomainDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: DomainsViewProps['onAdd'] }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">{open && <AddDomainForm onAdd={onAdd} onClose={() => onOpenChange(false)} />}</DialogContent>
        </Dialog>
    )
}

function AddDomainForm({ onAdd, onClose }: { onAdd: DomainsViewProps['onAdd']; onClose: () => void }) {
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
        const result = await onAdd(hostname)
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
                <Button type="button" variant="outline" onClick={onClose}>
                    {tCommon('cancel')}
                </Button>
                <Button type="submit" loading={sending} disabled={!typed.trim() || (left && !!problem)}>
                    {t('submit')}
                </Button>
            </DialogFooter>
        </form>
    )
}

function DomainSkeleton() {
    return (
        <div className={cn('space-y-4 p-4', PANEL_CARD)}>
            <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-8 w-full" />
            <div className="flex justify-end gap-2">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
            </div>
        </div>
    )
}
