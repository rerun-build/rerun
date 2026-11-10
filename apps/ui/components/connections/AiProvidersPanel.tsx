'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { AddProviderPage } from '@/components/connections/AddProviderPage'
import { AddCustomProviderPage } from '@/components/connections/custom/AddCustomProviderPage'
import { ConnectionDetail } from '@/components/connections/ConnectionDetail'
import { DefaultModelPicker } from '@/components/connections/DefaultModelPicker'
import { NoPlanNotice, useNeedsPlanToConnect } from '@/components/connections/NoPlanNotice'
import { ProviderPicker } from '@/components/connections/ProviderPicker'
import { CreditMeter, PlanLimitMeter, SourceAvatar, SourceStatus } from '@/components/connections/SourceBits'
import { Button } from '@/components/ui/button'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useRerunCredit } from '@/hooks/useRerunCredit'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import {
    keyProviders,
    PLAN_LABELS,
    connectMethod,
    planProviders,
    providerPitch,
    effectiveDefault,
    isCreditExhausted,
    isRerunPaused,
    isUsable,
    livePlanWindows,
    modelName,
    planWindowName,
    sourceKind,
    sourceSummary,
    tightestPlanWindow,
    type AddableProvider,
    type RerunCredit,
    type SourceKind,
} from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import type { BoxConnection, BoxDefault } from '@/lib/engine/types'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { RERUN_CONNECTION_ID } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { Stripes } from '@rerun/ui/primitives'
import { shortDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

const BRAND_STRIPES = 'color-mix(in oklab, var(--color-brand) 6%, transparent)'
const ORANGE_STRIPES = 'color-mix(in oklab, var(--color-orange-500) 6%, transparent)'

type ConnectionsPage = { kind: 'list' } | { kind: 'add'; provider: AddableProvider } | { kind: 'detail'; connectionId: string; reconnect?: boolean }

// `reconnect` is set when the provider turned the credential away: it is still on file, so the
// connection reads as connected and would otherwise offer no way to sign in again.
export type InitialConnection = { connectionId: string; reconnect: boolean }

// The workspace's AI providers: the default model on top, then every source its agents run on,
// grouped by how it is paid for. Opening a source or adding one drills down into the panel.
export function AiProvidersPanel({
    initialConnection,
    onInitialConnectionConsumed,
    initialAddProvider,
    onInitialAddProviderConsumed,
}: {
    // A chat error asking to sign a connection in again lands straight on that connection.
    initialConnection?: InitialConnection | null
    onInitialConnectionConsumed?: () => void
    // The model picker names a provider to add, so the panel opens on its form.
    initialAddProvider?: AddableProvider | null
    onInitialAddProviderConsumed?: () => void
}) {
    const t = useTranslations('connections')
    const errorText = useErrorText()
    const { connections, boxDefault, opencodeOffered, customOffered, loading, create, update, updateKeys, remove, setDefault } = useWorkspaceConnections({ revalidate: true })
    const credit = useRerunCredit()
    const needsPlan = useNeedsPlanToConnect()
    const workspaceAdmin = useIsWorkspaceAdmin()
    const readOnlyReason = workspaceAdmin ? undefined : t('panel.adminOnly')
    const [page, setPage] = useState<ConnectionsPage>({ kind: 'list' })

    useEffect(() => {
        if (!initialConnection) return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPage({ kind: 'detail', ...initialConnection })
        onInitialConnectionConsumed?.()
    }, [initialConnection, onInitialConnectionConsumed])

    useEffect(() => {
        if (!initialAddProvider) return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPage({ kind: 'add', provider: initialAddProvider })
        onInitialAddProviderConsumed?.()
    }, [initialAddProvider, onInitialAddProviderConsumed])

    // Derived rather than synced: a connection that disappeared (deleted here, or gone on a
    // refresh) simply drops the panel back to the list.
    const selected = page.kind === 'detail' ? connections.find(c => c.id === page.connectionId) : undefined
    const stepKey = page.kind === 'add' ? `add:${page.provider}` : (selected?.id ?? 'list')
    const current = effectiveDefault(boxDefault)
    // Same rule as the engine's: the first connection plugged in adopts the default.
    const willBecomeBoxDefault = !boxDefault && connections.every(c => c.id === RERUN_CONNECTION_ID || !c.connected)

    const open = (connectionId: string) => setPage({ kind: 'detail', connectionId })
    const add = (provider: AddableProvider) => setPage({ kind: 'add', provider })
    const back = () => setPage({ kind: 'list' })

    const createFromPage = useCallback((params: Parameters<typeof create>[0]) => create(params, 'add_provider'), [create])
    const rename = useCallback((connectionId: string, name: string) => update(connectionId, { name }), [update])

    const pickDefault = (pick: BoxDefault) =>
        void setDefault(pick).then(result => {
            if (!result.success) toast.error(errorText(result, t('errors.defaultFailed')))
        })

    const byKind = (kind: SourceKind) => connections.filter(c => sourceKind(c.provider) === kind)
    const taken = new Set(connections.map(c => c.provider))

    return (
        <PanelSteps stepKey={stepKey} depth={stepKey === 'list' ? 0 : 1}>
            {page.kind === 'add' && page.provider === 'custom' ? (
                <AddCustomProviderPage onBack={back} onCreate={createFromPage} onOpen={open} takenNames={connections.map(c => c.name)} willBecomeBoxDefault={willBecomeBoxDefault} />
            ) : page.kind === 'add' ? (
                <AddProviderPage key={page.provider} provider={page.provider} onBack={back} onCreate={createFromPage} onOpen={open} onRename={rename} takenNames={connections.map(c => c.name)} willBecomeBoxDefault={willBecomeBoxDefault} />
            ) : selected ? (
                <ConnectionDetail
                    connection={selected}
                    credit={credit}
                    defaultModel={current.connectionId === selected.id ? current.model : null}
                    reconnectRequested={page.kind === 'detail' && page.reconnect === true}
                    onReconnected={() => open(selected.id)}
                    onBack={back}
                    onUpdate={update}
                    onUpdateKeys={(id, body) => updateKeys(id, body, 'reconnect')}
                    onDelete={remove}
                    readOnlyReason={readOnlyReason}
                />
            ) : loading ? (
                <ConnectionsSkeleton />
            ) : (
                <PanelScroller className="space-y-6 p-4">
                    <Group title={t('panel.groups.default')}>
                        <DefaultRow connections={connections} current={current} credit={credit} onPick={pickDefault} onFix={open} readOnlyReason={readOnlyReason} />
                    </Group>

                    <Group title={t('panel.groups.included')}>
                        {byKind('included').map(source => (
                            <SourceRow key={source.id} source={source} credit={credit} onClick={() => open(source.id)}>
                                <CreditMeter percent={credit.percent} className="mt-1.5 max-w-56" />
                            </SourceRow>
                        ))}
                    </Group>

                    <SourceGroup
                        title={t('panel.groups.plans')}
                        only="plan"
                        sources={byKind('plan')}
                        credit={credit}
                        taken={taken}
                        onOpen={open}
                        onAdd={needsPlan ? undefined : add}
                        addDisabledReason={readOnlyReason}
                        pitch={opencodeOffered ? t('panel.pitch.plansWithOpencode') : t('panel.pitch.plans')}
                        providers={planProviders(opencodeOffered)}
                    />

                    <SourceGroup
                        title={t('panel.groups.keys')}
                        only="key"
                        sources={byKind('key')}
                        credit={credit}
                        taken={taken}
                        onOpen={open}
                        onAdd={needsPlan ? undefined : add}
                        addDisabledReason={readOnlyReason}
                        pitch={customOffered ? t('panel.pitch.keysWithCustom') : t('panel.pitch.keys')}
                        providers={keyProviders(customOffered)}
                    />

                    {needsPlan && (
                        <Group title={t('panel.groups.noPlan')}>
                            <NoPlanNotice />
                        </Group>
                    )}
                </PanelScroller>
            )}
        </PanelSteps>
    )
}

export function Group({ title, addMenu, children }: { title: string; addMenu?: ReactNode; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <div className="flex h-6 items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
                {addMenu}
            </div>
            <div className="space-y-1.5">{children}</div>
        </section>
    )
}

type DefaultRowProps = {
    connections: BoxConnection[]
    current: BoxDefault
    credit: RerunCredit
    onPick: (pick: BoxDefault) => void
    onFix: (connectionId: string) => void
    readOnlyReason?: string
}

function DefaultRow({ connections, current, credit, onPick, onFix, readOnlyReason }: DefaultRowProps) {
    const t = useTranslations('connections')
    const locale = useLocale()
    const source = connections.find(c => c.id === current.connectionId)
    const broken = source && !isUsable(source, credit)
    const creditGone = source && isCreditExhausted(source, credit)
    const creditPaused = source && isRerunPaused(source, credit)
    const canChange = connections.some(c => isUsable(c, credit))

    const description = !broken
        ? t('panel.default.via', { source: source?.name ?? 'Rerun' })
        : creditPaused
          ? canChange
              ? t('panel.default.pausedPick')
              : t('panel.default.pausedAdd')
          : creditGone
            ? credit.resetAt
                ? t(canChange ? 'panel.default.usedUpOnPick' : 'panel.default.usedUpOnAdd', { date: shortDate(credit.resetAt, locale) })
                : t(canChange ? 'panel.default.usedUpNextMonthPick' : 'panel.default.usedUpNextMonthAdd')
            : t('panel.default.stopped', { source: source.name })

    return (
        <div className="relative overflow-hidden rounded-md">
            <Stripes fade="right" color={broken ? ORANGE_STRIPES : BRAND_STRIPES} />
            <PanelRow
                className={cn('relative', broken && 'border-orange-500/30 bg-orange-500/5')}
                leading={<SourceAvatar provider={source?.provider ?? 'rerun'} />}
                title={modelName(current.connectionId, current.model)}
                description={description}
                actions={
                    <>
                        {broken && !creditGone && (
                            <TooltipDisabledReason reason={readOnlyReason}>
                                <Button size="xs" variant="outline" disabled={!!readOnlyReason} onClick={() => onFix(source.id)}>
                                    {connectMethod(source.provider) === 'key' ? t('addProvider.addKey') : t('status.signInAgain')}
                                </Button>
                            </TooltipDisabledReason>
                        )}
                        <TooltipDisabledReason reason={readOnlyReason ?? (canChange ? undefined : t('panel.default.noOtherModel'))}>
                            <DefaultModelPicker connections={connections} current={current} credit={credit} onPick={onPick}>
                                <Button size="xs" variant={broken && canChange ? 'default' : 'outline'} disabled={!canChange || !!readOnlyReason}>
                                    {t('panel.default.change')}
                                    <ChevronDownIcon className="size-3" />
                                </Button>
                            </DefaultModelPicker>
                        </TooltipDisabledReason>
                    </>
                }
            />
            <BorderBeam pattern="arcs" tone={broken ? 'orange' : 'brand'} />
        </div>
    )
}

type SourceGroupProps = {
    title: string
    only: 'plan' | 'key'
    sources: BoxConnection[]
    credit: RerunCredit
    taken: Set<string>
    onOpen: (connectionId: string) => void
    // Absent for a workspace with no plan: what it already holds stays reachable, nothing new can be added.
    onAdd?: (provider: AddableProvider) => void
    // Set for a member: the buttons stay in place, disabled, with this reason.
    addDisabledReason?: string
    pitch: string
    providers: AddableProvider[]
}

export function SourceGroup({ title, only, sources, credit, taken, onOpen, onAdd, addDisabledReason, pitch, providers }: SourceGroupProps) {
    const t = useTranslations('connections')
    if (!onAdd && sources.length === 0) return null

    // The pitch already offers every provider, so the header's Add only shows once the group has entries.
    const addLabel = only === 'plan' ? t('panel.addSubscription') : t('panel.addApiKey')
    const addMenu =
        onAdd && sources.length > 0 ? (
            addDisabledReason ? (
                <TooltipDisabledReason reason={addDisabledReason}>
                    <AddButton label={addLabel} disabled />
                </TooltipDisabledReason>
            ) : (
                <ProviderPicker taken={taken} onPick={onAdd} providers={providers}>
                    <AddButton label={addLabel} />
                </ProviderPicker>
            )
        ) : undefined

    return (
        <Group title={title} addMenu={addMenu}>
            {sources.map(source => {
                const tightest = source.connected ? tightestPlanWindow(livePlanWindows(source)) : null
                return (
                    <SourceRow key={source.id} source={source} credit={credit} onClick={() => onOpen(source.id)}>
                        {tightest && <PlanLimitMeter percent={tightest.usedPercent} label={t('meter.planLimit', { name: planWindowName(tightest, t, source.provider) })} className="mt-1.5 max-w-56" />}
                    </SourceRow>
                )
            })}
            {onAdd && sources.length === 0 && (
                <EmptyPitch
                    text={pitch}
                    actions={providers.map(provider => (
                        <TooltipDisabledReason key={provider} reason={addDisabledReason}>
                            <Button variant="outline" disabled={!!addDisabledReason} onClick={() => onAdd(provider)}>
                                <ProviderIcon provider={provider} className="size-4" />
                                {only === 'plan' ? PLAN_LABELS[provider] : providerPitch(provider, t).title}
                            </Button>
                        </TooltipDisabledReason>
                    ))}
                />
            )}
        </Group>
    )
}

function SourceRow({ source, credit, onClick, children }: { source: BoxConnection; credit: RerunCredit; onClick: () => void; children?: ReactNode }) {
    const t = useTranslations('connections')
    const locale = useLocale()
    return (
        <PanelRow
            onClick={onClick}
            leading={<SourceAvatar provider={source.provider} />}
            title={source.name}
            description={sourceSummary(source, credit, t, locale)}
            actions={
                <>
                    <SourceStatus source={source} credit={credit} />
                    <ChevronRightIcon className="ml-1 size-4 text-muted-foreground" />
                </>
            }
        >
            {children}
        </PanelRow>
    )
}

export function EmptyPitch({ text, actions }: { text: string; actions: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-3 py-5 text-center">
            <span className="text-xs text-muted-foreground">{text}</span>
            <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
        </div>
    )
}

export function AddButton({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
    return (
        <Button size="xs" variant="secondary" {...props}>
            <PlusIcon className="size-3" />
            {label}
        </Button>
    )
}

function ConnectionsSkeleton() {
    return (
        <div className="space-y-6 p-4">
            {[1, 1, 1, 2].map((rows, group) => (
                <div key={group} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    {Array.from({ length: rows }, (_, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                            <Skeleton className="size-9 rounded-md" />
                            <div className="flex-1 space-y-1.5">
                                <Skeleton className="h-3.5 w-28" />
                                <Skeleton className="h-2.5 w-40" />
                            </div>
                            <Skeleton className="h-4 w-12 rounded-full" />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}
