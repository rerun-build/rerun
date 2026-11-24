'use client'

import { VAULT_ACCOUNT_LABEL_MAX, vaultAccountLabel } from '@rerun/contracts'
import { useRenameField } from '@rerun/ui/forms'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { attachVaultEntryAction, deleteVaultEntryAction, detachVaultEntryAction, markVaultEntryAuthorizedAction, renameVaultEntryAction, shareVaultEntryAction, vaultCatalogAction, vaultEntryUsageAction } from '@/app/api/_actions/vault.actions'
import type { VaultEntryView, VaultListing } from '@/app/api/_services/vault.service'
import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { Group } from '@/components/connections/AiProvidersPanel'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { ComposioConnect } from '@/components/services/ComposioConnect'
import { ManagedConnect } from '@/components/services/ManagedConnect'
import { ServiceConfigForm } from '@/components/services/ServiceConfigForm'
import { ServiceSetupDriverProvider } from '@/components/services/service-setup-driver'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { ChevronLeftIcon, PencilIcon, Trash2Icon } from '@/lib/icons'
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
                {entry.kind === 'service' ? (
                    <AccountName entry={entry} listing={listing} onChanged={onChanged} />
                ) : (
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{entry.name}</span>
                        {entry.label && <span className="truncate text-[11px] text-muted-foreground">{entry.label}</span>}
                    </div>
                )}
                <VaultStatusBadge entry={entry} />
            </div>

            <PanelScroller className="space-y-6 p-4">
                <SignInSection entry={entry} canAdd={listing.canAdd} signingIn={signingIn} onSigningIn={setSigningIn} onChanged={onChanged} />

                <Group title={t('detail.coworkers')}>
                    <TooltipDisabledReason reason={everyoneReason} className="flex w-full">
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
                            <TooltipDisabledReason key={coworker.id} reason={reason} className="flex w-full">
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

// The app's name over the account's, and the pencil that renames the account in place. An emptied
// field gives it back the name its connection reported.
function AccountName({ entry, listing, onChanged }: { entry: VaultEntryView; listing: VaultListing; onChanged: () => Promise<void> }) {
    const t = useTranslations('vault')
    const errorText = useErrorText()
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const label = vaultAccountLabel(entry)
    const reason = !listing.canRename ? t('reasons.updateBox') : !entry.canChange ? (entry.sharedWithAll ? t('reasons.adminOnly') : t('reasons.manageBox')) : undefined

    const save = async (name: string) => {
        if (!name && !entry.customLabel) {
            setEditing(false)
            return
        }
        setSaving(true)
        const res = await renameVaultEntryAction(entry.id, name || null)
        if (!res.ok) toast.error(errorText(res as never, t('errors.changeFailed')))
        await onChanged()
        setSaving(false)
        setEditing(false)
    }

    return (
        <>
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{entry.name}</span>
                {editing ? (
                    <AccountNameField name={label ?? ''} placeholder={entry.label ?? t('detail.namePlaceholder')} busy={saving} onSubmit={name => void save(name)} onCancel={() => setEditing(false)} />
                ) : (
                    label && <span className="truncate text-[11px] text-muted-foreground">{label}</span>
                )}
            </div>
            {!editing && (
                <TooltipDisabledReason reason={reason} className="shrink-0">
                    <Button aria-label={t('detail.rename')} title={reason ? undefined : t('detail.rename')} variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" disabled={!!reason} onClick={() => setEditing(true)}>
                        <PencilIcon className="size-3.5" />
                    </Button>
                </TooltipDisabledReason>
            )}
        </>
    )
}

function AccountNameField({ name, placeholder, busy, onSubmit, onCancel }: { name: string; placeholder: string; busy: boolean; onSubmit: (name: string) => void; onCancel: () => void }) {
    const t = useTranslations('vault')
    const { inputProps } = useRenameField({ name, onSubmit, onCancel, busy, allowEmpty: true })
    return (
        <div className="mt-0.5 flex h-6 items-center gap-1 rounded-md bg-background pr-1.5 pl-1.5 text-[11px] ring-1 ring-primary ring-inset">
            <input {...inputProps} data-vault-account-name aria-label={t('detail.accountName')} placeholder={placeholder} maxLength={VAULT_ACCOUNT_LABEL_MAX} readOnly={busy} className="min-w-0 flex-1 bg-transparent outline-none selection:bg-foreground/20 read-only:opacity-60" />
            {busy && <Spinner className="size-3 text-muted-foreground" />}
        </div>
    )
}

function SignInSection({ entry, canAdd, signingIn, onSigningIn, onChanged }: { entry: VaultEntryView; canAdd: boolean; signingIn: boolean; onSigningIn: (on: boolean) => void; onChanged: () => Promise<void> }) {
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
    if (!entry.oauth && (entry.managed || entry.composio)) return <BrokeredSignIn entry={entry} canAdd={canAdd} signedOut={signedOut} onChanged={onChanged} />
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

// A managed or Composio account signed in again, once for every coworker using it. The click opens the
// window and starts the sign-in, whose callback turns the entry active.
function BrokeredSignIn({ entry, canAdd, signedOut, onChanged }: { entry: VaultEntryView; canAdd: boolean; signedOut: boolean; onChanged: () => Promise<void> }) {
    const t = useTranslations('vault')
    const tServices = useTranslations('services')
    const [attempt, setAttempt] = useState<{ popup: Window | null } | null>(null)

    const reconnect = (
        <TooltipDisabledReason reason={canAdd ? undefined : t('reasons.manageAny')}>
            <Button size="xs" variant="outline" disabled={!canAdd} onClick={() => setAttempt({ popup: openPendingSignInPopup(entry.name, tServices('signInPopup.connecting', { name: entry.name })) })}>
                {t('detail.reconnect')}
            </Button>
        </TooltipDisabledReason>
    )
    const connect = {
        agentId: '',
        vaultItemId: entry.id,
        instanceKey: entry.id,
        name: entry.name,
        autoStart: true,
        pendingPopup: attempt?.popup,
        onAuthorized: async () => {
            await onChanged()
            setAttempt(null)
        },
    }

    if (attempt) return entry.managed ? <ManagedConnect {...connect} provider={entry.managed.provider} serverName={entry.managed.serverName} /> : <ComposioConnect {...connect} />
    if (!signedOut) return <div className="flex justify-end">{reconnect}</div>
    return (
        <Alert variant="warning">
            <AlertDescription className="space-y-3">
                <p>{t('detail.signedOut', { name: entry.name })}</p>
                {reconnect}
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
