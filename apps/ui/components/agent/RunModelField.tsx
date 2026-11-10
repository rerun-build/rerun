'use client'

import { Field } from '@/components/ui/field'
import { ModelTierRow } from '@/components/agent/ModelTierRow'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useAvailableModels, type ConnectionGroup } from '@/hooks/useAvailableModels'
import { PREMIUM_MODEL_BILLING_TRIGGER, modelName } from '@/lib/engine/ai-sources'
import { modelLabel } from '@/lib/engine/models'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import type { EngineProvider } from '@/lib/engine/types'
import { cn } from '@/lib/utils'
import { useBillingStore } from '@/stores/billing.store'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

// A model id alone no longer identifies a choice: two Claude subscriptions both serve `opus`. The
// Select carries the pair, and this is the only place that knows how it is spelled.
const SEPARATOR = '::'

// Radix reserves the empty string for "no value", so "follow the agent" needs a sentinel of its own
// rather than the empty encoding a null pair would otherwise produce.
const AGENT_DEFAULT = 'agent-default'

export type RunModelPick = { connectionId: string | null; model: string | null }

function encode(pick: RunModelPick): string {
    return pick.model ? `${pick.connectionId ?? ''}${SEPARATOR}${pick.model}` : AGENT_DEFAULT
}

function decode(value: string): RunModelPick {
    if (value === AGENT_DEFAULT) return { connectionId: null, model: null }
    const at = value.indexOf(SEPARATOR)
    if (at === -1) return { connectionId: null, model: value }
    return { connectionId: value.slice(0, at) || null, model: value.slice(at + SEPARATOR.length) }
}

// Model picker for a run that fires without a user: a schedule or a webhook trigger. A new routine
// starts on the agent's own model, which is itself the Box default when the agent picked nothing,
// so it follows the Box instead of freezing today's pair forever.
export function useRunModel(agentId: string) {
    const { availableGroups, resolvedModel } = useAvailableModels(agentId)
    const [pick, setPick] = useState<RunModelPick>({ connectionId: null, model: null })

    // The engine stores a provider next to the connection for its telemetry and its prompt caching.
    // An id no group knows is one the user typed in: served by OpenRouter, like every custom model.
    const providerFor = useCallback(
        (value: RunModelPick): EngineProvider | null => (value.model ? ((availableGroups.find(g => g.connectionId === value.connectionId)?.provider ?? 'openrouter') as EngineProvider) : null),
        [availableGroups]
    )

    return { pick, setPick, availableGroups, providerFor, agentModel: resolvedModel }
}

type RunModelFieldProps = {
    id: string
    value: RunModelPick
    onChange: (pick: RunModelPick) => void
    availableGroups: ConnectionGroup[]
    helperText: string
    // What the agent's own model resolves to today, so the default entry is not a blind choice.
    agentModel?: string | null
    disabled?: boolean
}

export function RunModelField({ id, value, onChange, availableGroups, helperText, agentModel, disabled }: RunModelFieldProps) {
    const t = useTranslations('agent.runModelField')
    // Keep a pair that is no longer available (connection deleted, model switched off) selectable,
    // so the routine stays editable instead of silently losing it.
    const orphan = useMemo(
        () => (value.model && !availableGroups.some(g => g.connectionId === value.connectionId && g.models.some(m => m.id === value.model)) ? { connectionId: value.connectionId, model: value.model } : null),
        [availableGroups, value]
    )

    const agentDefaultLabel = agentModel ? t('coworkerDefaultWithModel', { model: modelLabel(agentModel) }) : t('coworkerDefault')
    // Spelled out rather than mirrored from the picked item: a tier's item is a two-line row.
    const triggerLabel = value.model ? modelName(value.connectionId ?? '', value.model) : agentDefaultLabel

    const pick = (encoded: string) => {
        const next = decode(encoded)
        const locked = availableGroups.find(g => g.connectionId === next.connectionId)?.models.find(m => m.id === next.model)?.locked
        if (locked) useBillingStore.getState().openBilling(undefined, PREMIUM_MODEL_BILLING_TRIGGER)
        else onChange(next)
    }

    return (
        <Field label={t('label')} htmlFor={id} helperText={helperText}>
            <Select value={encode(value)} onValueChange={pick} disabled={disabled}>
                <SelectTrigger id={id} className="h-8 w-full text-sm">
                    <SelectValue placeholder={t('placeholder')}>{triggerLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value={AGENT_DEFAULT}>{agentDefaultLabel}</SelectItem>
                    </SelectGroup>
                    {availableGroups.map(group => (
                        <SelectGroup key={group.connectionId}>
                            <SelectLabel className="flex items-center gap-1.5">
                                <ProviderIcon provider={group.provider} className="size-3.5" />
                                {group.label}
                            </SelectLabel>
                            {group.models.map(m => (
                                <TooltipDisabledReason key={m.id} reason={m.unavailable} side="right" className="flex w-full">
                                    <SelectItem
                                        value={encode({ connectionId: group.connectionId, model: m.id })}
                                        disabled={!!m.unavailable}
                                        className={cn('flex-1', (m.description || m.locked) && '*:[span]:last:flex-1')}
                                    >
                                        {m.description || m.locked ? <ModelTierRow label={m.label} description={m.description} power={m.power} locked={m.locked} /> : m.label}
                                    </SelectItem>
                                </TooltipDisabledReason>
                            ))}
                        </SelectGroup>
                    ))}
                    {orphan && (
                        <SelectGroup>
                            <SelectLabel>{t('current')}</SelectLabel>
                            <SelectItem value={encode(orphan)}>{modelLabel(orphan.model)}</SelectItem>
                        </SelectGroup>
                    )}
                </SelectContent>
            </Select>
        </Field>
    )
}
