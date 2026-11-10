'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { attachAgentToConnectionAction, getAgentAppBindingAction, getAppsOverviewAction, setAgentWakeEventsAction } from '@/app/api/_actions/apps.actions'
import type { AgentAppBinding, AppsOverview } from '@/app/api/_services/apps.service'
import { usePaidAppEnabled } from '@/components/layout/FeatureFlagsProvider'
import { AccountAvatar, AppIcon } from '@/components/apps/PaidAppViews'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { appInfo } from '@/lib/apps/catalog'
import type { AppSlug } from '@/lib/apps/types'
import { MessageSquareIcon, PlusIcon, UserCheck, UserPlus } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { usePaidAppsStore } from '@/stores/paid-apps.store'

const PICKABLE = new Set(['connected', 'paused', 'needs_reconnect'])

const WAKE_ROWS: Record<AppSlug, { event: string; icon: typeof MessageSquareIcon; timing: 'rightAway' | 'everyFewHours' }[]> = {
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
    binding: AgentAppBinding
    pending: string | null
    error: string | null
    onPick: (connectionId: string) => void
    onConnectNew: () => void
    onWakeChange: (events: string[]) => void
}

// The coworker's whole sign-in to a paid app: the account was connected once for the workspace,
// the coworker only picks which one it acts with, and whether its events wake it up. Picking is
// the install, so there is nothing to confirm after it.
export function AppAccountPickerView({ title, ...props }: AppAccountPickerViewProps) {
    const t = useTranslations('services.appAccount')
    const accounts = props.overview?.connections.filter(connection => PICKABLE.has(connection.status)) ?? []

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

function AppAccountPickerBody({
    slug,
    overview,
    binding,
    pending,
    error,
    accounts,
    onPick,
    onConnectNew,
    onWakeChange,
}: Omit<AppAccountPickerViewProps, 'title'> & { accounts: AppsOverview['connections'] }) {
    const t = useTranslations('services.appAccount')
    if (!overview) return <SkeletonPanelRows rows={2} className="p-0" />

    const { name: appName, providerLabel, wakeEventLabels } = appInfo(slug)
    const wake = binding?.wakeOnEvents ?? []
    const toggleEvent = (event: string, on: boolean) => onWakeChange(on ? [...wake, event] : wake.filter(current => current !== event))

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
                <div role="radiogroup" aria-label={t('accountName', { provider: providerLabel })} className="space-y-1.5">
                    {accounts.map(account => {
                        const selected = binding?.connectionId === account.id
                        const name = account.label ?? t('accountName', { provider: providerLabel })
                        return (
                            <button
                                key={account.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={pending !== null}
                                onClick={() => !selected && onPick(account.id)}
                                className={cn(
                                    'flex w-full items-center gap-3 p-3 text-left disabled:opacity-60',
                                    PANEL_CARD,
                                    selected ? 'border-foreground/40 bg-accent/40 disabled:opacity-100' : PANEL_CARD_INTERACTIVE,
                                )}
                            >
                                <AccountAvatar name={name} />
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate text-sm font-medium">{name}</span>
                                    <span className="truncate text-xs text-muted-foreground">{account.status === 'connected' ? (selected ? t('selected') : t('appAccount', { app: appName })) : t('needsAttention', { app: appName })}</span>
                                </span>
                                <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary' : 'border-muted-foreground/40')}>
                                    {selected && <span className="size-2 rounded-full bg-primary" />}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </Field>

            {binding && (
                <Field label={t('wakeWhen')}>
                    <div className={cn(PANEL_CARD, 'divide-y')}>
                        {WAKE_ROWS[slug].map(row => (
                            <label key={row.event} className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                                <row.icon className="size-4 shrink-0 text-muted-foreground" />
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="text-sm">{wakeEventLabels[row.event]}</span>
                                    <span className="text-[11px] text-muted-foreground">{t(`timing.${row.timing}`)}</span>
                                </span>
                                <Switch checked={wake.includes(row.event)} disabled={pending !== null} onCheckedChange={on => toggleEvent(row.event, on)} aria-label={wakeEventLabels[row.event]} />
                            </label>
                        ))}
                    </div>
                </Field>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
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
    const [binding, setBinding] = useState<AgentAppBinding>(null)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const apply = useCallback((apps: Awaited<ReturnType<typeof getAppsOverviewAction>>, current: Awaited<ReturnType<typeof getAgentAppBindingAction>>) => {
        if (apps.ok) setOverview(apps.value)
        else setError(errorText(apps))
        if (current.ok) setBinding(current.value)
    }, [errorText])

    const load = useCallback(async () => {
        const [apps, current] = await Promise.all([getAppsOverviewAction(slug), getAgentAppBindingAction(slug, agentId)])
        apply(apps, current)
    }, [slug, agentId, apply])

    useEffect(() => {
        if (!enabled) return
        let active = true
        void Promise.all([getAppsOverviewAction(slug), getAgentAppBindingAction(slug, agentId)]).then(([apps, current]) => {
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

    const pick = async (connectionId: string) => {
        setPending(connectionId)
        setError(null)
        const result = await attachAgentToConnectionAction(slug, agentId, connectionId)
        setPending(null)
        if (!result.ok) return setError(errorText(result))
        await load()
        onAuthorized()
    }

    const changeWake = async (events: string[]) => {
        setPending('wake')
        setError(null)
        const result = await setAgentWakeEventsAction(slug, agentId, events)
        setPending(null)
        if (!result.ok) return setError(errorText(result))
        await load()
    }

    return <AppAccountPickerView slug={slug} title={title} overview={overview} binding={binding} pending={pending} error={error} onPick={pick} onConnectNew={() => openApp(slug)} onWakeChange={changeWake} />
}
