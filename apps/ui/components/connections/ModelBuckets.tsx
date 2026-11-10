'use client'

import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { DetailBlock } from '@/components/connections/DetailBlock'
import { PowerBars } from '@/components/ui/power-bars'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { cliUnavailableReason, isModelEnabled, offeredModels } from '@/lib/engine/ai-sources'
import type { CatalogModel } from '@/lib/engine/models'
import type { BoxConnection } from '@/lib/engine/types'
import { EyeOffIcon, PlusIcon, StarIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { RERUN_CONNECTION_ID } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Bucket = 'available' | 'hidden'

const MODEL_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5'

// Seeded by the model id so the server render and the drag overlay land on the same angle.
function beamAngle(modelId: string) {
    let hash = 0
    for (const char of modelId) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return Math.abs(hash) % 360
}

function ChipFace({ model, muted, lifted, corner }: { model: CatalogModel; muted?: boolean; lifted?: boolean; corner?: ReactNode }) {
    return (
        <span className={cn('relative flex w-full flex-col gap-2 rounded-md border bg-background p-3', muted && 'text-muted-foreground', lifted && 'cursor-grabbing shadow-lg ring-1 ring-foreground/10')}>
            <span className="flex h-5 items-end justify-between gap-2">
                <PowerBars power={model.power} size="md" className={muted ? 'opacity-50' : ''} />
                {corner}
            </span>
            <span className="truncate text-xs font-medium">{model.label}</span>
            {!muted && <BorderBeam angle={beamAngle(model.id)} outset={1} />}
        </span>
    )
}

// `unavailable` is why the subscription's CLI cannot run the model on this box: still curated like any
// other, shown muted so a model that is switched on but cannot run does not read as ready.
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
        <div ref={setNodeRef} {...listeners} {...attributes} className={cn('group/chip touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring', lockReason ? 'cursor-not-allowed' : 'cursor-grab', isDragging && 'opacity-30')}>
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
    // The workspace default when it sits on this connection, which can never be turned off.
    defaultModel: string | null
    onModelsChange: (models: string[]) => void
}

// Which of a connection's models agents may pick: dragged between two zones, or moved with the
// button each chip shows on hover.
export function ModelBuckets({ connection, defaultModel, onModelsChange }: ModelBucketsProps) {
    const t = useTranslations('connections.models')
    const tConnections = useTranslations('connections')
    const [dragging, setDragging] = useState<CatalogModel | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor))
    const offered = offeredModels(connection)
    const available = offered.filter(m => isModelEnabled(connection, m.id))
    const hidden = offered.filter(m => !isModelEnabled(connection, m.id))

    if (connection.id === RERUN_CONNECTION_ID || offered.length <= 1) {
        // A custom endpoint's lone model is still the one thing saying what the server answered.
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
                <ModelZone
                    bucket="available"
                    title={t('available')}
                    aside={
                        <span className="text-[11px] text-muted-foreground">
                            {t('count', { on: available.length, total: offered.length })}
                        </span>
                    }
                    empty={t('availableEmpty')}
                    count={available.length}
                >
                    {available.map(model => (
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
                <ModelZone bucket="hidden" title={t('hidden')} empty={t('hiddenEmpty')} count={hidden.length}>
                    {hidden.map(model => (
                        <ModelChip key={model.id} model={model} bucket="hidden" isDefault={false} unavailable={cliUnavailableReason(connection, model.id, tConnections)} onMove={() => move(model.id, 'available')} />
                    ))}
                </ModelZone>
            </div>
            {/* PanelSteps slides with a transform, which would pin a fixed overlay to the panel instead of the viewport. */}
            {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={null}>{dragging && <ChipFace model={dragging} muted={!isModelEnabled(connection, dragging.id)} lifted />}</DragOverlay>, document.body)}
        </DndContext>
    )
}
