'use client'

import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { DotSpinner } from '@/components/ui/dot-spinner'
import { AddProviderItem, SUBSCRIPTION_PROVIDERS, SubscriptionNudge, SubscriptionPitch, type AddableProvider, type SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPillTrigger } from '@/components/agent/ModelPillTrigger'
import { PlanLimitDetail, PlanLimitHint, RerunCreditHint, rerunCreditDetail } from '@/components/agent/PlanLimitHint'
import { ModelTierRow } from '@/components/agent/ModelTierRow'
import { PowerBars } from '@/components/ui/power-bars'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { useAgentModel } from '@/hooks/useAgentModel'
import { useAvailableModels, type ConnectionGroup } from '@/hooks/useAvailableModels'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { refusedModelReason } from '@/lib/engine/model-groups'
import { useRerunCredit } from '@/hooks/useRerunCredit'
import { BOX_MANAGE_REASON } from '@/lib/board/box-access'
import { PREMIUM_MODEL_BILLING_TRIGGER, RERUN_CREDIT_PAUSED_REASON, pillUsage } from '@/lib/engine/ai-sources'
import { modelLabel } from '@/lib/engine/models'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { ChevronDownIcon, Settings2Icon, StarIcon } from '@/lib/icons'
import { useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useModelPickerStore } from '@/stores/model-picker.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { track } from '@rerun/analytics/client'
import { RERUN_CONNECTION_ID } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
}

// In-chat model picker shown in the prompt footer. One group per Box connection, so two Claude
// subscriptions read as two distinct choices rather than one ambiguous "Claude". Selecting a model
// sets a per-conversation override (see useAgentModel) that the chat transport sends with every
// message — it does NOT mutate the agent's persisted default config; the star does that.
//
// The "Box default" entry is the one exception: it is not a per-conversation choice but a statement
// about the agent, so it clears both the override and the pin in one click.
export function ModelSelector({ agentId, onReadyChange, onOwnConnectionChange, onConnectionChange, onRefusedModelChange, pickerKey }: ModelSelectorProps) {
    const [open, setOpen] = useState(false)
    const { availableGroups, connectionOf, pinnedModel, pinnedConnectionId, resolvedModel, resolvedConnectionId, followsBoxDefault, supportsBoxDefault, boxDefaultPick, setDefault, followBoxDefault, refreshConnections, loading } =
        useAvailableModels(agentId)
    const { selection, select } = useAgentModel(agentId)
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
    const hasAvailable = availableGroups.length > 0
    const connectedProviders = useMemo(() => new Set(availableGroups.map(group => group.provider)), [availableGroups])
    const missingSubscriptions = SUBSCRIPTION_PROVIDERS.filter(provider => !connectedProviders.has(provider))
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
    const refusedMessage = refusedReason ? `${modelLabel(model)} · ${refusedReason}. Pick another model below.` : null

    // A pin or an override that no longer resolves (a template just imported, a connection removed)
    // is repointed at whatever the Box can actually run, the Box default first: Rerun only heads the
    // list, it is not what the owner chose. Writing the override rather than just the display
    // matters: the chat transport sends the stored selection.
    useEffect(() => {
        if (loading || active || !hasAvailable || engineResolvesModel) return
        const fallback = connectionOf(model, connectionId) ?? availableGroups.find(group => group.connectionId === boxDefaultPick?.connectionId) ?? availableGroups[0]
        const nextModel = model && fallback.models.some(m => m.id === model) ? model : fallback.defaultModel
        select({ connectionId: fallback.connectionId, model: nextModel })
    }, [loading, active, hasAvailable, engineResolvesModel, availableGroups, connectionOf, boxDefaultPick, model, connectionId, select])

    // With nothing to pick from, the request lands where a model gets set up.
    useEffect(() => {
        if (!pickerKey || pickerRequestedFor !== pickerKey || loading) return
        consumePickerRequest()
        if (hasAvailable) setOpen(true)
        else openAiProviders()
    }, [pickerRequestedFor, pickerKey, loading, hasAvailable, consumePickerRequest, openAiProviders])

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
        if (canSetDefault) followBoxDefault()
        setOpen(false)
    }, [select, followBoxDefault, canSetDefault])

    useEffect(() => {
        // Don't report "not ready" while still loading — that would block the composer and flash a
        // false "no model" state before the fetch resolves.
        if (loading) return
        onReadyChange?.((Boolean(active) || (engineResolvesModel && hasAvailable)) && !refusedMessage)
        onOwnConnectionChange?.(hasOwnConnection)
        onConnectionChange?.(connectionId)
        onRefusedModelChange?.(refusedMessage)
    }, [loading, active, engineResolvesModel, hasAvailable, hasOwnConnection, connectionId, refusedMessage, onReadyChange, onOwnConnectionChange, onConnectionChange, onRefusedModelChange])

    const selectModel = useCallback(
        (group: ConnectionGroup, nextModel: string) => {
            select({ connectionId: group.connectionId, model: nextModel })
            setOpen(false)
        },
        [select]
    )

    const manage = useCallback(() => {
        setOpen(false)
        openAiProviders()
    }, [openAiProviders])

    const upgradeForModel = useCallback(() => {
        setOpen(false)
        useBillingStore.getState().openBilling(undefined, PREMIUM_MODEL_BILLING_TRIGGER)
    }, [])

    const addProvider = useCallback(
        (provider: AddableProvider) => {
            setOpen(false)
            addAiProvider(provider)
        },
        [addAiProvider]
    )

    const connectSubscription = useCallback(
        (provider: SubscriptionProvider) => {
            track('connection_cta_clicked', { source: 'model_picker' })
            addProvider(provider)
        },
        [addProvider]
    )

    const usage = active ? pillUsage(active, rerunCredit) : null
    const usageDetail = !usage || !active ? null : active.connectionId === RERUN_CONNECTION_ID ? rerunCreditDetail(rerunCredit) : <PlanLimitDetail windows={active.planWindows} provider={active.provider} />

    const label = !hasAvailable ? 'Set up a model' : engineResolvesModel ? `Default · ${modelLabel(model)}` : !active ? 'Select model' : modelLabel(model)

    const trigger = (
        <PopoverTrigger asChild>
            <ModelPillTrigger provider={active?.provider} label={label} usage={usage} className={refusedReason ? 'text-destructive hover:bg-destructive/10 hover:text-destructive aria-expanded:text-destructive' : undefined} />
        </PopoverTrigger>
    )

    if (loading) {
        return (
            <div className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground">
                <DotSpinner variant="light" size="xs" />
                Loading
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
        <Popover open={open} onOpenChange={setOpen}>
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
                        <CommandEmpty>No models available</CommandEmpty>
                        {supportsBoxDefault && boxDefaultPick && (
                            <CommandGroup>
                                <TooltipDisabledReason reason={canSetDefault || followsBoxDefault ? undefined : BOX_MANAGE_REASON} side="right" className="flex w-full">
                                    <CommandItem className="flex-1" value="workspace default model" data-checked={showingBoxDefault} disabled={!canSetDefault && !followsBoxDefault} onSelect={useBoxDefault}>
                                        <span className="min-w-0 flex-1 truncate">Workspace default</span>
                                        <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">{modelLabel(boxDefaultPick.model)}</span>
                                        {/* The star says what the agent runs by default, not what this conversation picked, so
                                            it stays filled while an override is in force. */}
                                        {followsBoxDefault && <StarIcon className="size-3.5 text-primary [&_polygon]:fill-current" />}
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
                                    const isDefault = pinnedConnectionId === group.connectionId && pinnedModel === m.id
                                    const disabledReason = group.connectionId === RERUN_CONNECTION_ID && rerunCredit.paused ? RERUN_CREDIT_PAUSED_REASON : m.unavailable
                                    if (disabledReason) {
                                        return (
                                            <TooltipDisabledReason key={m.id} reason={disabledReason} side="right" className="flex w-full">
                                                <CommandItem className="flex-1" value={`${group.label} ${m.label} ${m.id}`} disabled>
                                                    <ModelTierRow label={m.label} description={m.description} power={m.power} />
                                                </CommandItem>
                                            </TooltipDisabledReason>
                                        )
                                    }
                                    if (m.locked) {
                                        return (
                                            <CommandItem key={m.id} className="[&>svg:last-child]:hidden" value={`${group.label} ${m.label} ${m.id}`} onSelect={upgradeForModel}>
                                                <ModelTierRow label={m.label} description={m.description} power={m.power} locked />
                                            </CommandItem>
                                        )
                                    }
                                    const defaultStar = isDefault ? (
                                        <TooltipLabeled label="Coworker default">
                                            <span className="inline-flex shrink-0">
                                                <StarIcon className="size-3.5 text-primary [&_polygon]:fill-current" />
                                            </span>
                                        </TooltipLabeled>
                                    ) : !canSetDefault ? (
                                        <TooltipDisabledReason reason={BOX_MANAGE_REASON}>
                                            <span
                                                className="inline-flex"
                                                onClick={e => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                }}
                                            >
                                                <button type="button" tabIndex={-1} disabled aria-label={`Make ${m.label} this coworker's default`} className="shrink-0 text-muted-foreground opacity-40">
                                                    <StarIcon className="size-3.5" />
                                                </button>
                                            </span>
                                        </TooltipDisabledReason>
                                    ) : (
                                        <TooltipLabeled label="Set as coworker default">
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                aria-label={`Make ${m.label} this coworker's default`}
                                                className="shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover/model:opacity-70 hover:text-foreground hover:opacity-100"
                                                onClick={e => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    setDefault(group.connectionId, m.id, group.provider)
                                                }}
                                            >
                                                <StarIcon className="size-3.5" />
                                            </button>
                                        </TooltipLabeled>
                                    )
                                    if (m.description) {
                                        return (
                                            <CommandItem
                                                key={m.id}
                                                className="group/model"
                                                value={`${group.label} ${m.label} ${m.id}`}
                                                data-checked={active?.connectionId === group.connectionId && model === m.id}
                                                onSelect={() => selectModel(group, m.id)}
                                            >
                                                <ModelTierRow label={m.label} description={m.description} power={m.power} trailing={defaultStar} />
                                            </CommandItem>
                                        )
                                    }
                                    return (
                                        <CommandItem
                                            key={m.id}
                                            className="group/model"
                                            value={`${group.label} ${m.label} ${m.id}`}
                                            data-checked={active?.connectionId === group.connectionId && model === m.id}
                                            onSelect={() => selectModel(group, m.id)}
                                        >
                                            <span className="min-w-0 flex-1 truncate">{m.label}</span>
                                            {defaultStar}
                                            <PowerBars power={m.power} />
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
                            <AddProviderItem connectedProviders={connectedProviders} onConnect={addProvider} onManage={manage} />
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
