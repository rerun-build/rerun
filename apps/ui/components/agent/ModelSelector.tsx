'use client'

import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { DotSpinner } from '@/components/ui/dot-spinner'
import { AddProviderItem, SUBSCRIPTION_PROVIDERS, SubscriptionNudge, SubscriptionPitch, type AddableProvider, type SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { useBrand } from '@/components/brand/BrandProvider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPillTrigger } from '@/components/agent/ModelPillTrigger'
import { PlanLimitDetail, PlanLimitHint, RerunCreditHint, usePlanWindowsSummary, useRerunCreditDetail } from '@/components/agent/PlanLimitHint'
import { ModelTierRow } from '@/components/agent/ModelTierRow'
import { useClaudePlanOffered } from '@/components/connections/NoPlanNotice'
import { PowerBars } from '@/components/ui/power-bars'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { readAgentModel, useAgentModel, type ModelSelection } from '@/hooks/useAgentModel'
import { useAvailableModels, type ConnectionGroup } from '@/hooks/useAvailableModels'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { refusedModelReason } from '@/lib/engine/model-groups'
import { useRerunCredit } from '@/hooks/useRerunCredit'
import { pillUsage } from '@/lib/engine/ai-sources'
import { modelLabel } from '@/lib/engine/models'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { CheckIcon, ChevronDownIcon, Settings2Icon, StarIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { useModelPickerStore } from '@/stores/model-picker.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { track } from '@rerun/analytics/client'
import { acceptsReasoningEffort, REASONING_EFFORTS, RERUN_CONNECTION_ID, type ReasoningEffort } from '@rerun/contracts'
import { useIsMobile } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'

const EFFORT_LEVELS = [null, ...REASONING_EFFORTS] as const
const EFFORT_KEY = { default: 'effortDefault', low: 'effortLow', medium: 'effortMedium', high: 'effortHigh' } as const
const EFFORT_HINT_KEY = { default: 'effortDefaultHint', low: 'effortLowHint', medium: 'effortMediumHint', high: 'effortHighHint' } as const

// The submenu lives in a portal, but React still bubbles its events up to the model row beneath it:
// a click would pick the row without its level, and cmdk would read the arrows and Enter.
const keepInSubmenu = (e: SyntheticEvent) => e.stopPropagation()

// The settings icon of a model row that takes an effort, and the Reasoning submenu it opens beside
// the picker (under the row on a phone, where the side has no room). Picking a level picks the row.
function ReasoningEffortMenu({ modelName, effort, onPick }: { modelName: string; effort: ReasoningEffort | null; onPick: (effort: ReasoningEffort | null) => void }) {
    const t = useTranslations('agent.modelSelector')
    const isMobile = useIsMobile()
    const [open, setOpen] = useState(false)
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t('reasoningOf', { model: modelName })}
                    className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 aria-expanded:bg-muted aria-expanded:opacity-100"
                    onClick={keepInSubmenu}
                >
                    <Settings2Icon className="size-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                side={isMobile ? 'bottom' : 'right'}
                align={isMobile ? 'end' : 'start'}
                sideOffset={isMobile ? 4 : 12}
                className="w-60 gap-0 p-1"
                onClick={keepInSubmenu}
                onPointerMove={keepInSubmenu}
                onKeyDown={keepInSubmenu}
            >
                <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('reasoning')}</p>
                {EFFORT_LEVELS.map(level => (
                    <button
                        key={level ?? 'default'}
                        type="button"
                        onClick={() => {
                            setOpen(false)
                            onPick(level)
                        }}
                        className="flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                        <span className="flex-1">{t(EFFORT_KEY[level ?? 'default'])}</span>
                        <span className="text-xs text-muted-foreground">{t(EFFORT_HINT_KEY[level ?? 'default'])}</span>
                        <CheckIcon className={cn('size-3.5 shrink-0', level === effort ? 'opacity-100' : 'opacity-0')} />
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    )
}

// The star, the reasoning settings and the power bars each keep a fixed column at the end of every row,
// empty when the row has none, so they line up across rows. 17px is the width of the small PowerBars.
export function ModelRowControls({ star, effortMenu, power }: { star?: ReactNode; effortMenu?: ReactNode; power?: number }) {
    return (
        <span className="flex shrink-0 items-center gap-2">
            <span className="flex w-3.5 justify-center">{star}</span>
            <span className="flex w-6 justify-center">{effortMenu}</span>
            <span className="flex w-[17px] justify-end">
                <PowerBars power={power} />
            </span>
        </span>
    )
}

type ModelSelectorProps = {
    agentId: string
    // Notified whenever the effective model becomes usable (an active connection + a picked model)
    // or not — lets the composer block sending until a connection is set up.
    onReadyChange?: (ready: boolean) => void
    // Notified whether the Box holds a connection of its own beyond the keyless Rerun one — lets
    // the composer pitch bringing an AI subscription only to those who have none.
    onOwnConnectionChange?: (hasOwn: boolean) => void
    // Notified of the connection the next turn runs on, so an auth error can open that one.
    onConnectionChange?: (connectionId: string | null) => void
    // Notified of why the subscription refuses the model the next turn would run, or null: the
    // composer says it while it holds the message back.
    onRefusedModelChange?: (reason: string | null) => void
    // The key a notice outside the composer requests this picker open by (see model-picker.store).
    pickerKey?: string
    // A model picked in a picker that notice opened: the chat carries the turn the notice was about on.
    onPicked?: () => void
    // The conversation a pick belongs to (see useAgentModel). Without one the pick covers the agent.
    conversationId?: string
}

// In-chat model picker shown in the prompt footer. One group per Box connection, so two Claude
// subscriptions read as two distinct choices rather than one ambiguous "Claude". Selecting a model
// sets a per-conversation override (see useAgentModel) that the chat transport sends with every
// message — it does NOT mutate the agent's persisted default config; the star does that.
//
// The star and the "Box default" entry are statements about the agent, not choices for this
// conversation: each clears the conversation's override too, or the chat would go on sending the
// model the user just walked away from.
export function ModelSelector({ agentId, onReadyChange, onOwnConnectionChange, onConnectionChange, onRefusedModelChange, pickerKey, onPicked, conversationId }: ModelSelectorProps) {
    const t = useTranslations('agent.modelSelector')
    const tShared = useTranslations('agent.modelsShared')
    const { name: brandName } = useBrand()
    const creditDetail = useRerunCreditDetail()
    const windowsSummary = usePlanWindowsSummary()
    const [open, setOpen] = useState(false)
    const openedOnRequestRef = useRef(false)
    const { availableGroups, connectionOf, pinnedModel, pinnedConnectionId, pinnedEffort, resolvedModel, resolvedConnectionId, followsBoxDefault, supportsBoxDefault, boxDefaultPick, setDefault, followBoxDefault, refreshConnections, loading } =
        useAvailableModels(agentId)
    const { selection, select } = useAgentModel(agentId, conversationId)
    // Picking a model for this conversation stays open: only what the coworker runs by default is
    // managed through its Box. The foreman has no Box, so its default is left as it was.
    const canManageCoworker = useCanManageAgent(agentId)
    const isBoardCoworker = useBoardStore(state => state.agents.some(agent => agent.id === agentId))
    const canSetDefault = canManageCoworker || !isBoardCoworker
    const rerunCredit = useRerunCredit()
    const openAiProviders = useWorkspaceSettingsStore(state => state.openAiProviders)
    const addAiProvider = useWorkspaceSettingsStore(state => state.addAiProvider)
    const pickerRequestedFor = useModelPickerStore(state => state.openFor)
    const consumePickerRequest = useModelPickerStore(state => state.consume)

    const model = selection.model ?? pinnedModel ?? resolvedModel
    const connectionId = selection.connectionId ?? pinnedConnectionId ?? resolvedConnectionId
    // As the engine reads it: the conversation's level, else the coworker's on the model it was set for.
    const effort = selection.model && selection.effort !== undefined ? selection.effort : model === pinnedModel ? pinnedEffort : null
    const hasAvailable = availableGroups.length > 0
    const connectedProviders = useMemo(() => new Set(availableGroups.map(group => group.provider)), [availableGroups])
    const claudePlanOffered = useClaudePlanOffered()
    const missingSubscriptions = SUBSCRIPTION_PROVIDERS.filter(provider => !connectedProviders.has(provider) && (claudePlanOffered || provider !== 'claude'))
    const hasOwnConnection = availableGroups.some(group => group.connectionId !== RERUN_CONNECTION_ID)
    // Only when nothing at all was chosen: an override on this conversation is still a choice, and
    // the trigger has to say which model that turn will bill.
    const showingBoxDefault = followsBoxDefault && !selection.model
    // The engine resolves an agent that follows the Box on every run, so there is nothing to repair
    // here: an override written for it would freeze the conversation on whatever the picker read.
    const engineResolvesModel = showingBoxDefault && supportsBoxDefault

    // The pick is only usable when the connection it names still serves the model. A connection
    // deleted from the Box, or a model switched off on it, lands here.
    const active = useMemo(() => {
        const group = availableGroups.find(g => g.connectionId === connectionId)
        return group?.models.some(m => m.id === model) ? group : undefined
    }, [availableGroups, connectionId, model])

    // A pick the subscription refuses is kept, not swapped behind the user's back: the message is
    // held and the picker offers the models the plan does serve.
    const refusedReason = refusedModelReason(active, model)
    const modelText = model ? modelLabel(model, brandName) : t('select')
    const refusedMessage = refusedReason ? t('refused', { model: modelText, reason: refusedReason }) : null

    // A pin or an override that no longer resolves (a template just imported, a connection removed)
    // is repointed at whatever the Box can actually run, the Box default first: Rerun only heads the
    // list, it is not what the owner chose. Writing the override rather than just the display
    // matters: the chat transport sends the stored selection.
    useEffect(() => {
        if (loading || active || !hasAvailable || engineResolvesModel) return
        const fallback = connectionOf(model, connectionId) ?? availableGroups.find(group => group.connectionId === boxDefaultPick?.connectionId) ?? availableGroups[0]
        const nextModel = model && fallback.models.some(m => m.id === model) ? model : fallback.defaultModel
        select({ connectionId: fallback.connectionId, model: nextModel, effort: nextModel === model ? effort : null })
    }, [loading, active, hasAvailable, engineResolvesModel, availableGroups, connectionOf, boxDefaultPick, model, connectionId, effort, select])

    // With nothing to pick from, the request lands where a model gets set up.
    useEffect(() => {
        if (!pickerKey || pickerRequestedFor !== pickerKey || loading) return
        consumePickerRequest()
        if (hasAvailable) {
            openedOnRequestRef.current = true
            setOpen(true)
        } else openAiProviders()
    }, [pickerRequestedFor, pickerKey, loading, hasAvailable, consumePickerRequest, openAiProviders])

    const close = useCallback(() => {
        openedOnRequestRef.current = false
        setOpen(false)
    }, [])
    // A pick that writes the agent's config waits for it: the turn picked back up resolves its model
    // from that config on the engine.
    const closeOnPick = useCallback(
        (saved?: Promise<unknown>) => {
            const requested = openedOnRequestRef.current
            close()
            if (!requested || !onPicked) return
            if (saved) void saved.catch(() => {}).then(onPicked)
            else onPicked()
        },
        [close, onPicked]
    )
    const changeOpen = useCallback((next: boolean) => (next ? setOpen(true) : close()), [close])

    // A picker otherwise only loads the connections once per session, and a plan's limits move with
    // every run: opening the list is the moment someone is about to read them.
    useEffect(() => {
        if (open) void refreshConnections()
    }, [open, refreshConnections])

    // One click, one statement: this agent stops choosing and follows the Box, now and whenever the
    // Box default changes. Clearing the conversation override too, or the next message would still
    // carry the model the user just walked away from.
    const useBoxDefault = useCallback(() => {
        select({})
        closeOnPick(canSetDefault ? followBoxDefault() : undefined)
    }, [select, followBoxDefault, canSetDefault, closeOnPick])

    useEffect(() => {
        // Don't report "not ready" while still loading — that would block the composer and flash a
        // false "no model" state before the fetch resolves.
        if (loading) return
        onReadyChange?.((Boolean(active) || (engineResolvesModel && hasAvailable)) && !refusedMessage)
        onOwnConnectionChange?.(hasOwnConnection)
        onConnectionChange?.(connectionId)
        onRefusedModelChange?.(refusedMessage)
    }, [loading, active, engineResolvesModel, hasAvailable, hasOwnConnection, connectionId, refusedMessage, onReadyChange, onOwnConnectionChange, onConnectionChange, onRefusedModelChange])

    // The level a row shows and keeps when it is picked: the conversation's on the current row, the
    // coworker's on its default, the provider's everywhere else.
    const rowEffort = useCallback(
        (group: ConnectionGroup, rowModel: string): ReasoningEffort | null => {
            if (!acceptsReasoningEffort(group.provider, rowModel)) return null
            if (active?.connectionId === group.connectionId && model === rowModel) return effort
            return pinnedConnectionId === group.connectionId && pinnedModel === rowModel ? pinnedEffort : null
        },
        [active, model, effort, pinnedConnectionId, pinnedModel, pinnedEffort]
    )

    // The conversation carries the starred model until the engine has it as the default: a message sent
    // meanwhile, or after a save that failed, runs on what the pill says. A pick made meanwhile stays.
    const makeDefault = useCallback(
        async (group: ConnectionGroup, nextModel: string, nextEffort: ReasoningEffort | null) => {
            const starred: ModelSelection = { connectionId: group.connectionId, model: nextModel, effort: nextEffort }
            select(starred)
            const result = await setDefault(group.connectionId, nextModel, group.provider, nextEffort).catch(() => null)
            if (result?.success && readAgentModel(agentId, conversationId) === starred) select({})
        },
        [setDefault, select, agentId, conversationId]
    )

    const selectModel = useCallback(
        (group: ConnectionGroup, nextModel: string, nextEffort: ReasoningEffort | null) => {
            select({ connectionId: group.connectionId, model: nextModel, effort: nextEffort })
            closeOnPick()
        },
        [select, closeOnPick]
    )

    const manage = useCallback(() => {
        close()
        openAiProviders()
    }, [close, openAiProviders])

    const addProvider = useCallback(
        (provider: AddableProvider) => {
            close()
            addAiProvider(provider)
        },
        [close, addAiProvider]
    )

    const connectSubscription = useCallback(
        (provider: SubscriptionProvider) => {
            track('connection_cta_clicked', { source: 'model_picker' })
            addProvider(provider)
        },
        [addProvider]
    )

    const usage = active ? pillUsage(active, rerunCredit) : null
    const usageOfCredit = active?.connectionId === RERUN_CONNECTION_ID
    const usageLabel = !usage || !active ? null : usageOfCredit ? creditDetail(rerunCredit) : windowsSummary(usage.windows, active.provider)
    const usageDetail = !usage || !active ? null : usageOfCredit ? usageLabel : <PlanLimitDetail windows={active.planWindows} provider={active.provider} />

    const activeEffort = active && model ? rowEffort(active, model) : null
    const label = !hasAvailable ? t('setUp') : engineResolvesModel ? t('defaultLabel', { model: modelText }) : !active ? t('select') : activeEffort ? t('pillWithEffort', { model: modelText, effort: t(EFFORT_KEY[activeEffort]) }) : modelText

    const trigger = (
        <PopoverTrigger asChild>
            <ModelPillTrigger provider={active?.provider} label={label} usage={usage} usageLabel={usageLabel} className={refusedReason ? 'text-destructive hover:bg-destructive/10 hover:text-destructive aria-expanded:text-destructive' : undefined} />
        </PopoverTrigger>
    )

    if (loading) {
        return (
            <div className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground">
                <DotSpinner variant="light" size="xs" />
                {t('loading')}
                <ChevronDownIcon className="size-3" />
            </div>
        )
    }

    if (!hasAvailable) {
        return (
            <button
                type="button"
                onClick={manage}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
                {label}
                <Settings2Icon className="size-3" />
            </button>
        )
    }

    return (
        <Popover open={open} onOpenChange={changeOpen}>
            {usageDetail ? (
                <TooltipLabeled label={usageDetail} side="top">
                    {trigger}
                </TooltipLabeled>
            ) : (
                trigger
            )}
            <PopoverContent align="start" className="w-80 gap-0 p-0">
                <Command>
                    <CommandList className="max-h-[min(32rem,70vh)]">
                        <CommandEmpty>{t('empty')}</CommandEmpty>
                        {supportsBoxDefault && boxDefaultPick && (
                            <CommandGroup>
                                <TooltipDisabledReason reason={canSetDefault || followsBoxDefault ? undefined : tShared('boxManageReason')} side="right" className="flex w-full">
                                    <CommandItem className="flex-1" value="workspace default model" data-checked={showingBoxDefault} disabled={!canSetDefault && !followsBoxDefault} onSelect={useBoxDefault}>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{t('workspaceDefault')}</span>
                                            <span className="truncate text-[11px] text-muted-foreground">{modelLabel(boxDefaultPick.model, brandName)}</span>
                                        </span>
                                        {/* The star says what the agent runs by default, not what this conversation picked, so
                                            it stays filled while an override is in force. */}
                                        <ModelRowControls star={followsBoxDefault && <StarIcon className="size-3.5 text-primary [&_polygon]:fill-current" />} />
                                    </CommandItem>
                                </TooltipDisabledReason>
                            </CommandGroup>
                        )}
                        {availableGroups.map(group => (
                            <CommandGroup
                                key={group.connectionId}
                                heading={
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <ProviderIcon provider={group.provider} className="size-3.5 shrink-0" />
                                        <span className="truncate">{group.label}</span>
                                        {group.connectionId === RERUN_CONNECTION_ID ? <RerunCreditHint credit={rerunCredit} /> : <PlanLimitHint windows={group.planWindows} provider={group.provider} />}
                                    </span>
                                }
                            >
                                {group.models.map(m => {
                                    const levelOfRow = rowEffort(group, m.id)
                                    // The default is a model and its level: the coworker's model on another level
                                    // offers the star again, to save that level.
                                    const isDefault = pinnedConnectionId === group.connectionId && pinnedModel === m.id && levelOfRow === pinnedEffort
                                    const disabledReason = group.connectionId === RERUN_CONNECTION_ID && rerunCredit.paused ? tShared('creditPaused') : m.unavailable
                                    if (disabledReason) {
                                        return (
                                            <TooltipDisabledReason key={m.id} reason={disabledReason} side="right" className="flex w-full">
                                                <CommandItem className="flex-1" value={`${group.label} ${m.label} ${m.id}`} disabled>
                                                    <ModelTierRow label={m.label} description={m.description} trailing={<ModelRowControls power={m.power} />} />
                                                </CommandItem>
                                            </TooltipDisabledReason>
                                        )
                                    }
                                    const defaultStar = isDefault ? (
                                        <TooltipLabeled label={t('coworkerDefault')}>
                                            <span className="inline-flex shrink-0">
                                                <StarIcon className="size-3.5 text-primary [&_polygon]:fill-current" />
                                            </span>
                                        </TooltipLabeled>
                                    ) : !canSetDefault ? (
                                        <TooltipDisabledReason reason={tShared('boxManageReason')}>
                                            <span
                                                className="inline-flex"
                                                onClick={e => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                }}
                                            >
                                                <button type="button" tabIndex={-1} disabled aria-label={t('makeDefault', { model: m.label })} className="shrink-0 text-muted-foreground opacity-40">
                                                    <StarIcon className="size-3.5" />
                                                </button>
                                            </span>
                                        </TooltipDisabledReason>
                                    ) : (
                                        <TooltipLabeled label={t('setCoworkerDefault')}>
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                aria-label={t('makeDefault', { model: m.label })}
                                                className="shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover/model:opacity-70 hover:text-foreground hover:opacity-100"
                                                onClick={e => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    void makeDefault(group, m.id, levelOfRow)
                                                }}
                                            >
                                                <StarIcon className="size-3.5" />
                                            </button>
                                        </TooltipLabeled>
                                    )
                                    const effortMenu = acceptsReasoningEffort(group.provider, m.id) ? <ReasoningEffortMenu modelName={m.label} effort={levelOfRow} onPick={level => selectModel(group, m.id, level)} /> : null
                                    const effortLabel = levelOfRow && <span className="shrink-0 text-[11px] text-muted-foreground">{t(EFFORT_KEY[levelOfRow])}</span>
                                    const controls = <ModelRowControls star={defaultStar} effortMenu={effortMenu} power={m.power} />
                                    if (m.description) {
                                        return (
                                            <CommandItem
                                                key={m.id}
                                                className="group/model"
                                                value={`${group.label} ${m.label} ${m.id}`}
                                                data-checked={active?.connectionId === group.connectionId && model === m.id}
                                                onSelect={() => selectModel(group, m.id, levelOfRow)}
                                            >
                                                <ModelTierRow
                                                    label={m.label}
                                                    description={m.description}
                                                    trailing={
                                                        <>
                                                            {effortLabel}
                                                            {controls}
                                                        </>
                                                    }
                                                />
                                            </CommandItem>
                                        )
                                    }
                                    return (
                                        <CommandItem
                                            key={m.id}
                                            className="group/model"
                                            value={`${group.label} ${m.label} ${m.id}`}
                                            data-checked={active?.connectionId === group.connectionId && model === m.id}
                                            onSelect={() => selectModel(group, m.id, levelOfRow)}
                                        >
                                            <span className="min-w-0 flex-1 truncate">{m.label}</span>
                                            {effortLabel}
                                            {controls}
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        ))}
                        {missingSubscriptions.length > 0 &&
                            (hasOwnConnection ? (
                                <SubscriptionNudge providers={missingSubscriptions} onConnect={connectSubscription} />
                            ) : (
                                <SubscriptionPitch providers={missingSubscriptions} onConnect={connectSubscription} />
                            ))}
                        <CommandSeparator />
                        <CommandGroup>
                            <AddProviderItem connectedProviders={connectedProviders} claudePlanOffered={claudePlanOffered} onConnect={addProvider} onManage={manage} />
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
