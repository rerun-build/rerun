'use client'

import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { DotSpinner } from '@/components/ui/dot-spinner'
import { AddProviderItem, SUBSCRIPTION_PROVIDERS, SubscriptionNudge, SubscriptionPitch, type AddableProvider, type SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPillTrigger } from '@/components/agent/ModelPillTrigger'
import { PlanLimitDetail, PlanLimitHint, MoldwrightCreditHint, usePlanWindowsSummary, useMoldwrightCreditDetail } from '@/components/agent/PlanLimitHint'
import { ModelTierRow } from '@/components/agent/ModelTierRow'
import { PowerBars } from '@/components/ui/power-bars'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { useAgentModel } from '@/hooks/useAgentModel'
import { useAvailableModels, type ConnectionGroup } from '@/hooks/useAvailableModels'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { refusedModelReason } from '@/lib/engine/model-groups'
import { useMoldwrightCredit } from '@/hooks/useMoldwrightCredit'
import { PREMIUM_MODEL_BILLING_TRIGGER, pillUsage } from '@/lib/engine/ai-sources'
import { modelLabel } from '@/lib/engine/models'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { ChevronDownIcon, Settings2Icon, StarIcon } from '@/lib/icons'
import { useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useModelPickerStore } from '@/stores/model-picker.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { track } from '@moldwright/analytics/client'
import { RERUN_CONNECTION_ID } from '@moldwright/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ModelSelectorProps = {
    agentId: string
    onReadyChange?: (ready: boolean) => void
    onOwnConnectionChange?: (hasOwn: boolean) => void
    onConnectionChange?: (connectionId: string | null) => void
    onRefusedModelChange?: (reason: string | null) => void
    pickerKey?: string
}

export function ModelSelector({ agentId, onReadyChange, onOwnConnectionChange, onConnectionChange, onRefusedModelChange, pickerKey }: ModelSelectorProps) {
    const t = useTranslations('agent.modelSelector')
    const tShared = useTranslations('agent.modelsShared')
    const creditDetail = useMoldwrightCreditDetail()
    const windowsSummary = usePlanWindowsSummary()
    const [open, setOpen] = useState(false)
    const { availableGroups, connectionOf, pinnedModel, pinnedConnectionId, resolvedModel, resolvedConnectionId, followsBoxDefault, supportsBoxDefault, boxDefaultPick, setDefault, followBoxDefault, refreshConnections, loading } =
        useAvailableModels(agentId)
    const { selection, select } = useAgentModel(agentId)
    const canManageCoworker = useCanManageAgent(agentId)
    const isBoardCoworker = useBoardStore(state => state.agents.some(agent => agent.id === agentId))
    const canSetDefault = canManageCoworker || !isBoardCoworker
    const rerunCredit = useMoldwrightCredit()
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
    const showingBoxDefault = followsBoxDefault && !selection.model
    const engineResolvesModel = showingBoxDefault && supportsBoxDefault

    const active = useMemo(() => {
        const group = availableGroups.find(g => g.connectionId === connectionId)
        return group?.models.some(m => m.id === model) ? group : undefined
    }, [availableGroups, connectionId, model])

    const refusedReason = refusedModelReason(active, model)
    const modelText = model ? modelLabel(model) : t('select')
    const refusedMessage = refusedReason ? t('refused', { model: modelText, reason: refusedReason }) : null

    useEffect(() => {
        if (loading || active || !hasAvailable || engineResolvesModel) return
        const fallback = connectionOf(model, connectionId) ?? availableGroups.find(group => group.connectionId === boxDefaultPick?.connectionId) ?? availableGroups[0]
        const nextModel = model && fallback.models.some(m => m.id === model) ? model : fallback.defaultModel
        select({ connectionId: fallback.connectionId, model: nextModel })
    }, [loading, active, hasAvailable, engineResolvesModel, availableGroups, connectionOf, boxDefaultPick, model, connectionId, select])

    useEffect(() => {
        if (!pickerKey || pickerRequestedFor !== pickerKey || loading) return
        consumePickerRequest()
        if (hasAvailable) setOpen(true)
        else openAiProviders()
    }, [pickerRequestedFor, pickerKey, loading, hasAvailable, consumePickerRequest, openAiProviders])

    useEffect(() => {
        if (open) void refreshConnections()
    }, [open, refreshConnections])

    const useBoxDefault = useCallback(() => {
        select({})
        if (canSetDefault) followBoxDefault()
        setOpen(false)
    }, [select, followBoxDefault, canSetDefault])

    useEffect(() => {
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
    const usageOfCredit = active?.connectionId === RERUN_CONNECTION_ID
    const usageLabel = !usage || !active ? null : usageOfCredit ? creditDetail(rerunCredit) : windowsSummary(usage.windows, active.provider)
    const usageDetail = !usage || !active ? null : usageOfCredit ? usageLabel : <PlanLimitDetail windows={active.planWindows} provider={active.provider} />

    const label = !hasAvailable ? t('setUp') : engineResolvesModel ? t('defaultLabel', { model: modelText }) : !active ? t('select') : modelText

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
                        <CommandEmpty>{t('empty')}</CommandEmpty>
                        {supportsBoxDefault && boxDefaultPick && (
                            <CommandGroup>
                                <TooltipDisabledReason reason={canSetDefault || followsBoxDefault ? undefined : tShared('boxManageReason')} side="right" className="flex w-full">
                                    <CommandItem className="flex-1" value="workspace default model" data-checked={showingBoxDefault} disabled={!canSetDefault && !followsBoxDefault} onSelect={useBoxDefault}>
                                        <span className="min-w-0 flex-1 truncate">{t('workspaceDefault')}</span>
                                        <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">{modelLabel(boxDefaultPick.model)}</span>
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
                                        {group.connectionId === RERUN_CONNECTION_ID ? <MoldwrightCreditHint credit={rerunCredit} /> : <PlanLimitHint windows={group.planWindows} provider={group.provider} />}
                                    </span>
                                }
                            >
                                {group.models.map(m => {
                                    const isDefault = pinnedConnectionId === group.connectionId && pinnedModel === m.id
                                    const disabledReason = group.connectionId === RERUN_CONNECTION_ID && rerunCredit.paused ? tShared('creditPaused') : m.unavailable
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
