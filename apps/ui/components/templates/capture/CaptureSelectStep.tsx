'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonList } from '@/components/ui/skeleton'
import { BotIcon } from '@/lib/icons'
import type { CaptureSourceSpace } from '@/lib/templates/capture'
import { CaptureAgentRow } from './CaptureAgentRow'

const FILTER_THRESHOLD = 8

export function CaptureSelectStep({
    spaces,
    spaceId,
    loading,
    failed,
    selectedIds,
    onSpaceChange,
    onToggle,
    onSelectionChange,
}: {
    spaces: CaptureSourceSpace[]
    spaceId: string
    loading: boolean
    failed: boolean
    selectedIds: string[]
    onSpaceChange: (spaceId: string) => void
    onToggle: (agentId: string) => void
    onSelectionChange: (agentIds: string[]) => void
}) {
    const t = useTranslations('templates.capture.select')
    const [query, setQuery] = React.useState('')

    const space = spaces.find(s => s.id === spaceId)
    const agents = space?.agents ?? []
    const needle = query.trim().toLowerCase()
    const visible = needle ? agents.filter(agent => `${agent.name} ${agent.handle}`.toLowerCase().includes(needle)) : agents
    const allSelected = agents.length > 0 && agents.every(agent => selectedIds.includes(agent.id))

    if (loading) return <SkeletonList rows={4} />

    // A failed load already states why underneath, and an empty state on top of it would read as
    // "there is nothing to capture" rather than "we could not ask".
    if (spaces.length === 0) {
        if (failed) return null
        return (
            <EmptyState
                icon={BotIcon}
                title={t('emptyTitle')}
                description={t('emptyDescription')}
            />
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {/* A single source Box is already selected for the flow, so the control would only ever
                confirm itself. Its name moves into the list title instead. */}
            {spaces.length > 1 && (
                <Field label={t('box')}>
                    <Select value={spaceId} onValueChange={onSpaceChange}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t('boxPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {spaces.map(option => (
                                <SelectItem key={option.id} value={option.id}>
                                    {option.name ?? t('boxFallback')} ({option.agents.length})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            )}

            {space && (
                <Field label={spaces.length > 1 || !space.name ? t('coworkers') : t('coworkersIn', { box: space.name })}>
                    <div className="flex flex-col gap-2">
                        {agents.length > FILTER_THRESHOLD && (
                            <Input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={t('search')}
                                className="h-9"
                            />
                        )}

                        {agents.length > 1 && (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{t('selected', { selected: selectedIds.length, total: agents.length })}</span>
                                <button
                                    type="button"
                                    className="text-foreground/70 transition-colors hover:text-foreground"
                                    onClick={() => onSelectionChange(allSelected ? [] : agents.map(agent => agent.id))}
                                >
                                    {allSelected ? t('clear') : t('selectAll')}
                                </button>
                            </div>
                        )}

                        <div className="flex flex-col gap-1">
                            {visible.map(agent => (
                                <CaptureAgentRow
                                    key={agent.id}
                                    agent={agent}
                                    checked={selectedIds.includes(agent.id)}
                                    onToggle={() => onToggle(agent.id)}
                                />
                            ))}
                            {visible.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{t('noMatch')}</p>}
                        </div>
                    </div>
                </Field>
            )}
        </div>
    )
}
