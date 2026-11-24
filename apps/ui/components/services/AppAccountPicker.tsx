'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { attachAgentToConnectionAction, detachAgentFromConnectionAction, getAgentAppAccountsAction, getAppsOverviewAction, setAgentWakeEventsAction } from '@/app/api/_actions/apps.actions'
import type { AgentAppAccount, AppsOverview } from '@/app/api/_services/apps.service'
import { usePaidAppEnabled } from '@/components/layout/FeatureFlagsProvider'
import { AccountAvatar, AppIcon } from '@/components/apps/PaidAppViews'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { appInfo } from '@/lib/apps/catalog'
import type { WakeEvent as LinkedinWakeEvent } from '@/lib/apps/linkedin/wake-events'
import type { AppSlug } from '@/lib/apps/types'
import type { WakeEvent as WhatsappWakeEvent } from '@/lib/apps/whatsapp/wake-events'
import { MessageSquareIcon, PlusIcon, UserCheck, UserPlus } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { usePaidAppsStore } from '@/stores/paid-apps.store'

const PICKABLE = new Set(['connected', 'paused', 'needs_reconnect'])

const pickableAccounts = (overview: AppsOverview | null) => overview?.connections.filter(connection => PICKABLE.has(connection.status)) ?? []

const WAKE_ROWS: Record<AppSlug, { event: LinkedinWakeEvent | WhatsappWakeEvent; icon: typeof MessageSquareIcon; timing: 'rightAway' | 'everyFewHours' }[]> = {
    linkedin: [
        { event: 'message_received', icon: MessageSquareIcon, timing: 'rightAway' },
        { event: 'accepted_invitation', icon: UserCheck, timing: 'everyFewHours' },
        { event: 'invitation_received', icon: UserPlus, timing: 'everyFewHours' },
    ],
    whatsapp: [{ event: 'message_received', icon: MessageSquareIcon, timing: 'rightAway' }],
}

export type AppAccountPickerViewProps = {
    slug: AppSlug
    title: string
    overview: AppsOverview | null
    held: AgentAppAccount[]
    pending: string | null
    error: string | null
    onToggle: (connectionId: string, on: boolean) => void
    onConnectNew: () => void
    onWakeChange: (connectionId: string, events: string[]) => void
    onDone: () => void
}

// The coworker's whole sign-in to a paid app: the accounts were connected once for the workspace, the
// coworker only picks those it acts with, and whether the events of each wake it up. Every choice is
// saved as it is made: Done only closes, once there are several accounts to choose from.
export function AppAccountPickerView({ title, ...props }: AppAccountPickerViewProps) {
    const t = useTranslations('services.appAccount')
    const accounts = pickableAccounts(props.overview)

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{title}</p>
                {accounts.length > 0 && (
                    <Button variant="outline" size="sm" onClick={props.onConnectNew}>
                        <PlusIcon />
                        {t('addAccount')}
                    </Button>
                )}
            </div>
            <AppAccountPickerBody {...props} accounts={accounts} />
        </div>
    )
}

type BodyProps = Omit<AppAccountPickerViewProps, 'title'> & { accounts: AppsOverview['connections'] }

function AppAccountPickerBody({ slug, overview, held, pending, error, accounts, onToggle, onConnectNew, onWakeChange, onDone }: BodyProps) {
    const t = useTranslations('services.appAccount')
    if (!overview) return <SkeletonPanelRows rows={2} className="p-0" />

    const { providerLabel } = appInfo(slug)

    if (accounts.length === 0) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-6 text-center">
                <AppIcon slug={slug} size="md" />
                <div className="space-y-1">
                    <p className="text-sm font-medium">{t('connectTitle', { provider: providerLabel })}</p>
                    <p className="text-xs text-pretty text-muted-foreground">{t('connectHint')}</p>
                </div>
                <Button size="sm" onClick={onConnectNew}>
                    {t('connect', { provider: providerLabel })}
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <Field label={t('actsAs')}>
                <div role="group" aria-label={t('accountName', { provider: providerLabel })} className="space-y-1.5">
                    {accounts.map(account => (
                        <AccountCard
                            key={account.id}
                            slug={slug}
                            account={account}
                            binding={held.find(candidate => candidate.connectionId === account.id) ?? null}
                            isLast={held.length === 1}
                            disabled={pending !== null}
                            onToggle={on => onToggle(account.id, on)}
                            onWakeChange={events => onWakeChange(account.id, events)}
                        />
                    ))}
                </div>
            </Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
            {accounts.length > 1 && (
                <Button size="sm" className="w-full" disabled={held.length === 0 || pending !== null} onClick={onDone}>
                    {t('done')}
                </Button>
            )}
        </div>
    )
}

type AccountCardProps = {
    slug: AppSlug
    account: AppsOverview['connections'][number]
    binding: AgentAppAccount | null
    isLast: boolean
    disabled: boolean
    onToggle: (on: boolean) => void
    onWakeChange: (events: string[]) => void
}

function AccountCard({ slug, account, binding, isLast, disabled, onToggle, onWakeChange }: AccountCardProps) {
    const t = useTranslations('services.appAccount')
    const { name: appName, providerLabel } = appInfo(slug)
    const name = account.label ?? t('accountName', { provider: providerLabel })
    const wake = binding?.wakeOnEvents ?? []
    const lastReason = binding && isLast ? t('lastAccount', { app: appName }) : undefined
    const toggleEvent = (event: string, on: boolean) => onWakeChange(on ? [...wake, event] : wake.filter(current => current !== event))

    return (
        <div className={cn(PANEL_CARD, binding ? 'border-foreground/40 bg-accent/40' : PANEL_CARD_INTERACTIVE)}>
            <TooltipDisabledReason reason={lastReason} className="flex w-full">
                <label className={cn('flex w-full items-center gap-3 p-3 text-start', lastReason ? 'cursor-not-allowed' : 'cursor-pointer', disabled && !binding && 'opacity-60')}>
                    <AccountAvatar name={name} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{name}</span>
                        <span className="truncate text-xs text-muted-foreground">{account.status === 'connected' ? (binding ? t('selected') : t('appAccount', { app: appName })) : t('needsAttention', { app: appName })}</span>
                    </span>
                    <Checkbox size="sm" checked={!!binding} disabled={disabled || !!lastReason} onCheckedChange={on => onToggle(on === true)} aria-label={name} />
                </label>
            </TooltipDisabledReason>

            {binding && (
                <div role="group" aria-label={t('wakeWhenAccount', { account: name })} className="border-t">
                    <Field label={t('wakeWhen')} className="gap-0 px-3 pt-2.5">
                        {WAKE_ROWS[slug].map(row => (
                            <label key={row.event} className="flex cursor-pointer items-center gap-3 py-2.5">
                                <row.icon className="size-4 shrink-0 text-muted-foreground" />
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="text-sm">{t(`wakeEvents.${row.event}`)}</span>
                                    <span className="text-[11px] text-muted-foreground">{t(`timing.${row.timing}`)}</span>
                                </span>
                                <Switch checked={wake.includes(row.event)} disabled={disabled} onCheckedChange={on => toggleEvent(row.event, on)} aria-label={t(`wakeEvents.${row.event}`)} />
                            </label>
                        ))}
                    </Field>
                </div>
            )}
        </div>
    )
}

export function AppAccountPicker({ slug, title, agentId, onAuthorized }: { slug: AppSlug; title: string; agentId: string; onAuthorized: () => void }) {
    const t = useTranslations('services.appAccount')
    const errorText = useErrorText()
    const enabled = usePaidAppEnabled(slug)
    const revision = usePaidAppsStore(s => s.revision)
    const openApp = usePaidAppsStore(s => s.openApp)
    const [overview, setOverview] = useState<AppsOverview | null>(null)
    const [held, setHeld] = useState<AgentAppAccount[]>([])
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const apply = useCallback((apps: Awaited<ReturnType<typeof getAppsOverviewAction>>, current: Awaited<ReturnType<typeof getAgentAppAccountsAction>>) => {
        if (apps.ok) setOverview(apps.value)
        else setError(errorText(apps))
        if (current.ok) setHeld(current.value)
    }, [errorText])

    const load = useCallback(async () => {
        const [apps, current] = await Promise.all([getAppsOverviewAction(slug), getAgentAppAccountsAction(slug, agentId)])
        apply(apps, current)
    }, [slug, agentId, apply])

    useEffect(() => {
        if (!enabled) return
        let active = true
        void Promise.all([getAppsOverviewAction(slug), getAgentAppAccountsAction(slug, agentId)]).then(([apps, current]) => {
            if (active) apply(apps, current)
        })
        return () => {
            active = false
        }
    }, [enabled, slug, agentId, apply, revision])

    if (!enabled)
        return (
            <div className="space-y-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{t('unavailable', { app: appInfo(slug).name })}</p>
            </div>
        )

    const run = async (key: string, change: () => ReturnType<typeof attachAgentToConnectionAction>) => {
        setPending(key)
        setError(null)
        const result = await change()
        if (!result.ok) setError(errorText(result))
        await load()
        setPending(null)
        return result.ok
    }

    const toggle = async (connectionId: string, on: boolean) => {
        const saved = await run(connectionId, () => (on ? attachAgentToConnectionAction(slug, agentId, connectionId) : detachAgentFromConnectionAction(slug, agentId, connectionId)))
        if (saved && on && pickableAccounts(overview).length === 1) onAuthorized()
    }

    const changeWake = (connectionId: string, events: string[]) => run('wake', () => setAgentWakeEventsAction(slug, agentId, connectionId, events))

    return <AppAccountPickerView slug={slug} title={title} overview={overview} held={held} pending={pending} error={error} onToggle={toggle} onConnectNew={() => openApp(slug)} onWakeChange={changeWake} onDone={onAuthorized} />
}
