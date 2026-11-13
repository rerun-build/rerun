'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { attachVaultEntryAction, deleteVaultEntryAction, detachVaultEntryAction, markVaultEntryAuthorizedAction, shareVaultEntryAction, vaultCatalogAction, vaultEntryUsageAction } from '@/app/api/_actions/vault.actions'
import type { VaultEntryView, VaultListing } from '@/app/api/_services/vault.service'
import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { Group } from '@/components/connections/AiProvidersPanel'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { ServiceConfigForm } from '@/components/services/ServiceConfigForm'
import { ServiceSetupDriverProvider } from '@/components/services/service-setup-driver'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { ChevronLeftIcon, Trash2Icon } from '@/lib/icons'
import type { AuthMethodSummary } from '@/lib/services/types'
import { VaultStatusBadge } from './VaultPanel'
import { vaultSetupDriver } from './vault-setup-driver'

type Props = { entry: VaultEntryView; listing: VaultListing; icon: ReactNode; onBack: () => void; onChanged: () => Promise<void> }

// One entry of the Vault: where its sign-in stands, who uses it, and the way out.
export function VaultEntryDetail({ entry, listing, icon, onBack, onChanged }: Props) {
    const t = useTranslations('vault')
    const errorText = useErrorText()
    const [busy, setBusy] = useState<string | null>(null)
    const [signingIn, setSigningIn] = useState(false)

    const run = async (key: string, action: () => Promise<{ ok: true } | { ok: false; error: string; code?: string }>) => {
        setBusy(key)
        const res = await action()
        if (!res.ok) toast.error(errorText(res as never, t('errors.changeFailed')))
        await onChanged()
        setBusy(null)
    }

    const attached = (engineAgentId: string) => entry.sharedWithAll || entry.agentIds.includes(engineAgentId)
    const everyoneReason = !listing.isAdmin ? t('reasons.adminOnly') : entry.app ? t('reasons.paidAppEveryone') : undefined

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b px-3 py-2.5">
                <Button aria-label={t('detail.back')} variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack}>
                    <ChevronLeftIcon className="size-4" />
                </Button>
                {icon}
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{entry.name}</span>
                    {entry.label && <span className="truncate text-[11px] text-muted-foreground">{entry.label}</span>}
                </div>
                <VaultStatusBadge entry={entry} />
            </div>

            <PanelScroller className="space-y-6 p-4">
                <SignInSection entry={entry} signingIn={signingIn} onSigningIn={setSigningIn} onChanged={onChanged} />

                <Group title={t('detail.coworkers')}>
                    <TooltipDisabledReason reason={everyoneReason}>
                        <PanelRow
                            title={t('detail.everyone')}
                            description={t('detail.everyoneHint')}
                            actions={
                                <Switch
                                    checked={entry.sharedWithAll}
                                    disabled={!!everyoneReason || busy !== null}
                                    aria-label={t('detail.everyone')}
                                    onCheckedChange={checked => void run('everyone', () => shareVaultEntryAction(entry.id, checked))}
                                />
                            }
                        />
                    </TooltipDisabledReason>
                    {listing.coworkers.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t('detail.noCoworkers')}</p>}
                    {listing.coworkers.map(coworker => {
                        const reason = !coworker.canManage ? t('reasons.manageBox') : undefined
                        const on = attached(coworker.engineAgentId)
                        return (
                            <TooltipDisabledReason key={coworker.id} reason={reason}>
                                <PanelRow
                                    title={coworker.name}
                                    actions={
                                        <Switch
                                            checked={on}
                                            disabled={!!reason || entry.sharedWithAll || busy !== null}
                                            aria-label={coworker.name}
                                            onCheckedChange={checked => void run(coworker.id, () => (checked ? attachVaultEntryAction(entry.id, coworker.id) : detachVaultEntryAction(entry.id, coworker.id)))}
                                        />
                                    }
                                />
                            </TooltipDisabledReason>
                        )
                    })}
                    {entry.hiddenCoworkers > 0 && <p className="px-1 text-xs text-muted-foreground">{t('detail.hiddenCoworkers', { count: entry.hiddenCoworkers })}</p>}
                </Group>

                {entry.envKeys.length > 0 && (
                    <Group title={t('detail.variables')}>
                        <div className="flex flex-wrap gap-1.5">
                            {entry.envKeys.map(key => (
                                <code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                    {key}
                                </code>
                            ))}
                        </div>
                    </Group>
                )}

                <DeleteEntry entry={entry} isAdmin={listing.isAdmin} onDeleted={async () => {
                    onBack()
                    await onChanged()
                }} />
            </PanelScroller>
        </div>
    )
}

function SignInSection({ entry, signingIn, onSigningIn, onChanged }: { entry: VaultEntryView; signingIn: boolean; onSigningIn: (on: boolean) => void; onChanged: () => Promise<void> }) {
    const t = useTranslations('vault')

    if (entry.status === 'needs_config' && entry.slug) {
        return (
            <Alert>
                <AlertDescription className="space-y-3">
                    <p>{t('detail.notSetUp', { name: entry.name })}</p>
                    <SetupForm entry={entry} onDone={onChanged} />
                </AlertDescription>
            </Alert>
        )
    }

    const signedOut = entry.status === 'needs_auth'
    // A managed or Composio sign-in starts from a coworker for now: say where to go.
    if (!entry.oauth && signedOut && (entry.managed || entry.composio)) {
        return (
            <Alert variant="warning">
                <AlertDescription>
                    {t('detail.signedOut', { name: entry.name })} {t('detail.reconnectFromCoworker')}
                </AlertDescription>
            </Alert>
        )
    }
    if (!entry.oauth) return null
    if (!signedOut && !signingIn) {
        return (
            <div className="flex justify-end">
                <Button size="xs" variant="outline" onClick={() => onSigningIn(true)}>
                    {t('detail.reconnect')}
                </Button>
            </div>
        )
    }
    return (
        <Alert variant={signedOut ? 'warning' : 'default'}>
            <AlertDescription className="space-y-3">
                {signedOut && <p>{t('detail.signedOut', { name: entry.name })}</p>}
                <McpOAuthAuthorize
                    url={entry.oauth.url}
                    agentId=""
                    vaultItemId={entry.id}
                    serverName={entry.oauth.serverName}
                    onAuthorized={async () => {
                        await markVaultEntryAuthorizedAction(entry.id)
                        onSigningIn(false)
                        await onChanged()
                    }}
                />
            </AlertDescription>
        </Alert>
    )
}

// The install form of the entry's app, filled in again: its sign-in methods come from the catalog.
function SetupForm({ entry, onDone }: { entry: VaultEntryView; onDone: () => Promise<void> }) {
    const [methods, setMethods] = useState<AuthMethodSummary[] | null>(null)
    const driver = useMemo(() => vaultSetupDriver({ itemId: entry.id, agentIds: [], onItem: () => {} }, entry.name), [entry.id, entry.name])

    useEffect(() => {
        let cancelled = false
        void vaultCatalogAction(entry.slug ?? '').then(res => {
            if (!cancelled) setMethods(res.ok ? (res.result.find(app => app.slug === entry.slug)?.authMethods ?? []) : [])
        })
        return () => {
            cancelled = true
        }
    }, [entry.slug])

    if (!methods || methods.length === 0) return null
    return (
        <ServiceSetupDriverProvider value={driver}>
            <ServiceConfigForm vault agentId="" slug={entry.slug ?? ''} instanceKey={entry.id} name={entry.name} authMethods={methods} initialMethodId={entry.authMethodId} onInstalled={() => void onDone()} />
        </ServiceSetupDriverProvider>
    )
}

function DeleteEntry({ entry, isAdmin, onDeleted }: { entry: VaultEntryView; isAdmin: boolean; onDeleted: () => Promise<void> }) {
    const t = useTranslations('vault')
    const errorText = useErrorText()
    const [open, setOpen] = useState(false)
    const [loses, setLoses] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const ask = async () => {
        setOpen(true)
        setLoses(null)
        const res = await vaultEntryUsageAction(entry.id)
        if (!res.ok) return setLoses('')
        const names = res.result.coworkers.map(c => c.name)
        if (res.result.hidden > 0) names.push(t('detail.hiddenCoworkers', { count: res.result.hidden }))
        setLoses(names.length > 0 ? t('delete.loses', { names: names.join(', ') }) : t('delete.nobody'))
    }

    return (
        <div className="flex justify-end">
            <TooltipDisabledReason reason={isAdmin ? undefined : t('reasons.adminOnly')}>
                <Button size="xs" variant="ghost" className="text-destructive" disabled={!isAdmin} onClick={() => void ask()}>
                    <Trash2Icon className="size-3.5" />
                    {t('delete.button')}
                </Button>
            </TooltipDisabledReason>
            <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                title={t('delete.title', { name: entry.name })}
                description={loses ?? '…'}
                confirmLabel={t('delete.confirm')}
                confirmVariant="destructive"
                pending={pending || loses === null}
                onConfirm={async () => {
                    setPending(true)
                    const res = await deleteVaultEntryAction(entry.id)
                    setPending(false)
                    setOpen(false)
                    if (!res.ok) return void toast.error(errorText(res))
                    toast.success(t('delete.deleted', { name: entry.name }))
                    await onDeleted()
                }}
            />
        </div>
    )
}
