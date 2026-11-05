'use client'

import { AddProviderPage } from '@/components/connections/AddProviderPage'
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
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import {
    KEY_PROVIDERS,
    PLAN_LABELS,
    connectMethod,
    planProviders,
    PROVIDER_PITCH,
    creditResetPhrase,
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
    const { connections, boxDefault, opencodeOffered, loading, create, update, updateKeys, remove, setDefault } = useWorkspaceConnections({ revalidate: true })
    const credit = useRerunCredit()
    const needsPlan = useNeedsPlanToConnect()
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
            if (!result.success) toast.error(result.error ?? 'Failed to change the default model')
        })

    const byKind = (kind: SourceKind) => connections.filter(c => sourceKind(c.provider) === kind)
    const taken = new Set(connections.map(c => c.provider))

    return (
        <PanelSteps stepKey={stepKey} depth={stepKey === 'list' ? 0 : 1}>
            {page.kind === 'add' ? (
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
                />
            ) : loading ? (
                <ConnectionsSkeleton />
            ) : (
                <PanelScroller className="space-y-6 p-4">
                    <Group title="Default model">
                        <DefaultRow connections={connections} current={current} credit={credit} onPick={pickDefault} onFix={open} />
                    </Group>

                    <Group title="Included">
                        {byKind('included').map(source => (
                            <SourceRow key={source.id} source={source} credit={credit} onClick={() => open(source.id)}>
                                <CreditMeter percent={credit.percent} className="mt-1.5 max-w-56" />
                            </SourceRow>
                        ))}
                    </Group>

                    <SourceGroup
                        title="Your subscriptions"
                        only="plan"
                        sources={byKind('plan')}
                        credit={credit}
                        taken={taken}
                        onOpen={open}
                        onAdd={needsPlan ? undefined : add}
                        pitch={opencodeOffered ? 'Already use Claude Code, Codex or OpenCode? Your coworkers can run on your plan.' : 'Already use Claude Code or Codex? Your coworkers can run on your plan.'}
                        providers={planProviders(opencodeOffered)}
                    />

                    <SourceGroup
                        title="Your API keys"
                        only="key"
                        sources={byKind('key')}
                        credit={credit}
                        taken={taken}
                        onOpen={open}
                        onAdd={needsPlan ? undefined : add}
                        pitch="Pay your provider directly, per token."
                        providers={KEY_PROVIDERS}
                    />

                    {needsPlan && (
                        <Group title="Your subscriptions and API keys">
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
}

function DefaultRow({ connections, current, credit, onPick, onFix }: DefaultRowProps) {
    const source = connections.find(c => c.id === current.connectionId)
    const broken = source && !isUsable(source, credit)
    const creditGone = source && isCreditExhausted(source, credit)
    const creditPaused = source && isRerunPaused(source, credit)
    const canChange = connections.some(c => isUsable(c, credit))

    const description = !broken
        ? `Via ${source?.name ?? 'Rerun'}. Coworkers with no model of their own run on it.`
        : creditPaused
          ? `Rerun credits are paused, so coworkers with no model of their own are paused too. ${canChange ? 'Pick another model' : 'Add a plan or an API key'} to keep them going.`
          : creditGone
          ? `Rerun credits are used up until they are back ${creditResetPhrase(credit)}, so coworkers with no model of their own are paused. ${canChange ? 'Pick another model' : 'Add a plan or an API key'} to keep them going.`
          : `Coworkers with no model of their own are stopped. Fix ${source.name} or pick another model.`

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
                            <Button size="xs" variant="outline" onClick={() => onFix(source.id)}>
                                {connectMethod(source.provider) === 'key' ? 'Add key' : 'Sign in again'}
                            </Button>
                        )}
                        <TooltipDisabledReason reason={canChange ? undefined : 'No other model is ready. Add a plan or an API key first.'}>
                            <DefaultModelPicker connections={connections} current={current} credit={credit} onPick={onPick}>
                                <Button size="xs" variant={broken && canChange ? 'default' : 'outline'} disabled={!canChange}>
                                    Change
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
    pitch: string
    providers: AddableProvider[]
}

export function SourceGroup({ title, only, sources, credit, taken, onOpen, onAdd, pitch, providers }: SourceGroupProps) {
    if (!onAdd && sources.length === 0) return null

    // The pitch already offers every provider, so the header's Add only shows once the group has entries.
    const addMenu =
        onAdd && sources.length > 0 ? (
            <ProviderPicker only={only} taken={taken} onPick={onAdd} planProviders={only === 'plan' ? providers : undefined}>
                <AddButton label={only === 'plan' ? 'Add subscription' : 'Add API key'} />
            </ProviderPicker>
        ) : undefined

    return (
        <Group title={title} addMenu={addMenu}>
            {sources.map(source => {
                const tightest = source.connected ? tightestPlanWindow(livePlanWindows(source)) : null
                return (
                    <SourceRow key={source.id} source={source} credit={credit} onClick={() => onOpen(source.id)}>
                        {tightest && <PlanLimitMeter percent={tightest.usedPercent} label={`${planWindowName(tightest, source.provider)} limit used`} className="mt-1.5 max-w-56" />}
                    </SourceRow>
                )
            })}
            {onAdd && sources.length === 0 && (
                <EmptyPitch
                    text={pitch}
                    actions={providers.map(provider => (
                        <Button key={provider} variant="outline" onClick={() => onAdd(provider)}>
                            <ProviderIcon provider={provider} className="size-4" />
                            {only === 'plan' ? PLAN_LABELS[provider] : PROVIDER_PITCH[provider].title}
                        </Button>
                    ))}
                />
            )}
        </Group>
    )
}

function SourceRow({ source, credit, onClick, children }: { source: BoxConnection; credit: RerunCredit; onClick: () => void; children?: ReactNode }) {
    return (
        <PanelRow
            onClick={onClick}
            leading={<SourceAvatar provider={source.provider} />}
            title={source.name}
            description={sourceSummary(source, credit)}
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
