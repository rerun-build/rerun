'use client'

import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { DetailBlock } from '@/components/connections/DetailBlock'
import { Input } from '@/components/ui/input'
import { PowerBars } from '@/components/ui/power-bars'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { cliUnavailableReason, isModelEnabled, offeredModels } from '@/lib/engine/ai-sources'
import type { CatalogModel } from '@/lib/engine/models'
import type { BoxConnection } from '@/lib/engine/types'
import { EyeOffIcon, PlusIcon, SearchIcon, StarIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { RERUN_CONNECTION_ID } from '@moldwright/contracts'
import { BorderBeam } from '@moldwright/ui'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Bucket = 'available' | 'hidden'

const MODEL_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5'
const SEARCH_FROM = 25

function matchesWords(model: CatalogModel, words: string[]) {
    const haystack = `${model.label} ${model.id}`.toLowerCase()
    return words.every(word => haystack.includes(word))
}

function beamAngle(modelId: string) {
    let hash = 0
    for (const char of modelId) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return Math.abs(hash) % 360
}

function ChipFace({ model, muted, lifted, corner }: { model: CatalogModel; muted?: boolean; lifted?: boolean; corner?: ReactNode }) {
    return (
        <span title={`${model.label}\n${model.id}`} className={cn('relative flex w-full flex-col gap-2 rounded-md border bg-background p-3', muted && 'text-muted-foreground', lifted && 'cursor-grabbing shadow-lg ring-1 ring-foreground/10')}>
            <span className="flex h-5 items-end justify-between gap-2">
                <PowerBars power={model.power} size="md" className={muted ? 'opacity-50' : ''} />
                {corner}
            </span>
            <span className="line-clamp-2 min-h-8 text-xs leading-4 font-medium break-words">{model.label}</span>
            {!muted && <BorderBeam angle={beamAngle(model.id)} outset={1} />}
        </span>
    )
}

function ModelChip({
    model,
    bucket,
    isDefault,
    lockReason,
    unavailable,
    onMove,
}: {
    model: CatalogModel
    bucket: Bucket
    isDefault: boolean
    lockReason?: string
    unavailable?: string
    onMove: () => void
}) {
    const t = useTranslations('connections.models')
    const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: model.id, disabled: !!lockReason })
    const MoveIcon = bucket === 'available' ? EyeOffIcon : PlusIcon

    const chip = (
        <div ref={setNodeRef} data-model-id={model.id} {...listeners} {...attributes} className={cn('group/chip touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring', lockReason ? 'cursor-not-allowed' : 'cursor-grab', isDragging && 'opacity-30')}>
            <ChipFace
                model={model}
                muted={bucket === 'hidden' || !!unavailable}
                corner={
                    isDefault ? (
                        <StarIcon aria-label={t('defaultModel')} className="size-3.5 self-start text-yellow-400 [&_polygon]:fill-current" />
                    ) : (
                        !lockReason && (
                            <button
                                type="button"
                                aria-label={bucket === 'available' ? t('turnOff', { model: model.label }) : t('turnOn', { model: model.label })}
                                onClick={onMove}
                                onKeyDown={e => e.stopPropagation()}
                                className="-mr-1 flex size-5 items-center justify-center self-start rounded-sm text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100 hover:text-foreground focus-visible:opacity-100"
                            >
                                <MoveIcon className="size-3" />
                            </button>
                        )
                    )
                }
            />
        </div>
    )

    const reason = lockReason ?? unavailable
    return reason ? <TooltipLabeled label={reason}>{chip}</TooltipLabeled> : chip
}

function ModelZone({ bucket, title, aside, empty, count, children }: { bucket: Bucket; title: string; aside?: ReactNode; empty: string; count: number; children: ReactNode }) {
    const { setNodeRef, isOver, active } = useDroppable({ id: bucket })
    return (
        <DetailBlock title={title} aside={aside}>
            <div
                ref={setNodeRef}
                className={cn(
                    count === 0 ? 'flex items-center' : MODEL_GRID,
                    'min-h-12 rounded-md border p-2 transition-colors',
                    bucket === 'available' ? 'bg-muted/20' : 'border-dashed',
                    active && 'border-foreground/20',
                    isOver && 'border-solid border-foreground/40 bg-accent/60'
                )}
            >
                {count === 0 ? <span className="px-1 text-[11px] text-muted-foreground">{empty}</span> : children}
            </div>
        </DetailBlock>
    )
}

type ModelBucketsProps = {
    connection: BoxConnection
    defaultModel: string | null
    onModelsChange: (models: string[]) => void
}

export function ModelBuckets({ connection, defaultModel, onModelsChange }: ModelBucketsProps) {
    const t = useTranslations('connections.models')
    const tConnections = useTranslations('connections')
    const [dragging, setDragging] = useState<CatalogModel | null>(null)
    const [query, setQuery] = useState('')
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor))
    const offered = offeredModels(connection)
    const available = offered.filter(m => isModelEnabled(connection, m.id))
    const hidden = offered.filter(m => !isModelEnabled(connection, m.id))
    const searchable = offered.length >= SEARCH_FROM
    const words = searchable ? query.toLowerCase().split(/\s+/).filter(Boolean) : []
    const shownAvailable = available.filter(m => matchesWords(m, words))
    const shownHidden = hidden.filter(m => matchesWords(m, words))
    const noMatch = t('noMatch', { query: query.trim() })

    if (connection.id === RERUN_CONNECTION_ID || offered.length <= 1) {
        if (available.length === 0 || (available.length === 1 && connection.provider !== 'custom')) return null
        return (
            <DetailBlock title={t('title')}>
                <div className={MODEL_GRID}>
                    {available.map(model => (
                        <ChipFace key={model.id} model={model} />
                    ))}
                </div>
            </DetailBlock>
        )
    }

    const lockReason = (model: CatalogModel) => {
        if (model.id === defaultModel) return t('lockDefault')
        if (connection.extraModels.includes(model.id)) return t('lockCustom')
        if (available.length === 1) return t('lockLast')
        return undefined
    }

    const move = (modelId: string, to: Bucket) => {
        const model = offered.find(m => m.id === modelId)
        if (!model || isModelEnabled(connection, model.id) === (to === 'available')) return
        if (to === 'hidden' && lockReason(model)) return
        onModelsChange(to === 'available' ? [...connection.models, model.id] : connection.models.filter(m => m !== model.id))
    }

    const onDragEnd = (event: DragEndEvent) => {
        setDragging(null)
        if (event.over) move(String(event.active.id), event.over.id as Bucket)
    }

    return (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={e => setDragging(offered.find(m => m.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="space-y-4">
                {searchable && (
                    <div className="relative">
                        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="search"
                            aria-label={t('search')}
                            placeholder={t('search')}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={event => {
                                if (event.key !== 'Escape' || !query) return
                                event.preventDefault()
                                event.stopPropagation()
                                setQuery('')
                            }}
                            className="h-8 pl-8 text-xs"
                        />
                    </div>
                )}
                <ModelZone
                    bucket="available"
                    title={t('available')}
                    aside={
                        <span className="text-[11px] text-muted-foreground">
                            {t('count', { on: available.length, total: offered.length })}
                        </span>
                    }
                    empty={words.length ? noMatch : t('availableEmpty')}
                    count={shownAvailable.length}
                >
                    {shownAvailable.map(model => (
                        <ModelChip
                            key={model.id}
                            model={model}
                            bucket="available"
                            isDefault={model.id === defaultModel}
                            lockReason={lockReason(model)}
                            unavailable={cliUnavailableReason(connection, model.id, tConnections)}
                            onMove={() => move(model.id, 'hidden')}
                        />
                    ))}
                </ModelZone>
                <ModelZone
                    bucket="hidden"
                    title={t('hidden')}
                    aside={words.length > 0 && <span className="text-[11px] text-muted-foreground">{t('matches', { count: shownHidden.length })}</span>}
                    empty={words.length ? noMatch : t('hiddenEmpty')}
                    count={shownHidden.length}
                >
                    {shownHidden.map(model => (
                        <ModelChip key={model.id} model={model} bucket="hidden" isDefault={false} unavailable={cliUnavailableReason(connection, model.id, tConnections)} onMove={() => move(model.id, 'available')} />
                    ))}
                </ModelZone>
            </div>
            {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={null}>{dragging && <ChipFace model={dragging} muted={!isModelEnabled(connection, dragging.id)} lifted />}</DragOverlay>, document.body)}
        </DndContext>
    )
}
