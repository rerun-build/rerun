'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { rowKey, type DbRow } from '@/components/data/DataBrowserTable'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { DataSource } from '@/lib/data/source'
import { boardColumns, isSummable, type BoardColumn } from '@/lib/data/views'
import { DatabaseIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import type { TableView } from '@rerun/contracts'
import { BoardColumnHeader, BoardItem, type CellContext } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

const PER_COLUMN = 25

type Lane = BoardColumn & { rows: DbRow[]; limit: number }
type DragData = { row: DbRow; from: string }

type ViewBoardProps = {
    source: DataSource
    table: string
    view: TableView & { groupBy: string }
    query: string
    refreshKey: number
    context: CellContext
    onOpenRow?: (row: DbRow) => void
}

export function ViewBoard({ source, table, view, query, refreshKey, context, onOpenRow }: ViewBoardProps) {
    const t = useTranslations('data')
    const errorText = useErrorText()
    const { groupBy, where, sort, tones } = view
    const fields = view.fields ?? {}
    const formats = view.formats ?? {}
    const valueFormat = fields.value ? formats[fields.value] : undefined
    const sumColumn = isSummable(valueFormat) ? fields.value : undefined
    const [lanes, setLanes] = useState<Lane[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [dragged, setDragged] = useState<DbRow | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))

    const readLane = useCallback(
        (value: BoardColumn['value'], limit: number) =>
            source.readRows(table, { limit, offset: 0, sort: sort?.column, dir: sort?.dir, q: query || undefined, where: [...(where ?? []), { column: groupBy, equals: value }] }),
        [source, table, sort, query, where, groupBy],
    )

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const result = await source.readGroups(table, { groupBy, sum: sumColumn, q: query || undefined, where })
            if (cancelled) return
            if (!result.success) {
                setError(errorText(result))
                setLanes([])
                return
            }
            const columns = boardColumns(result.groups, tones)
            const reads = await Promise.all(columns.map(column => (column.total > 0 ? readLane(column.value, PER_COLUMN) : Promise.resolve(null))))
            if (cancelled) return
            setError(null)
            setLanes(columns.map((column, i) => ({ ...column, rows: (reads[i]?.rows ?? []) as DbRow[], limit: PER_COLUMN })))
        })()
        return () => {
            cancelled = true
        }
    }, [source, table, groupBy, sumColumn, query, where, tones, readLane, refreshKey, errorText])

    const showMore = async (lane: Lane) => {
        const limit = lane.limit + PER_COLUMN
        const result = await readLane(lane.value, limit)
        if (result) setLanes(current => current?.map(l => (l.key === lane.key ? { ...l, rows: result.rows as DbRow[], limit } : l)) ?? null)
    }

    const move = async (row: DbRow, from: string, to: string) => {
        const target = lanes?.find(lane => lane.key === to)
        const id = rowKey(row)
        if (!lanes || !target || id === null) return
        const previous = lanes
        const amount = sumColumn ? Number(row[sumColumn]) || 0 : 0
        const moved = { ...row, [groupBy]: target.value }
        setLanes(
            lanes.map(lane => {
                if (lane.key === from) return { ...lane, rows: lane.rows.filter(r => rowKey(r) !== id), total: lane.total - 1, sum: lane.sum === undefined ? undefined : lane.sum - amount }
                if (lane.key === to) return { ...lane, rows: [moved, ...lane.rows], total: lane.total + 1, sum: sumColumn ? (lane.sum ?? 0) + amount : lane.sum }
                return lane
            }),
        )
        const result = await source.updateRow(table, id, { [groupBy]: target.value })
        if (!result.success) {
            setLanes(previous)
            toast.error(t('board.moveFailed'), { description: errorText(result) })
        }
    }

    const onDragStart = (event: DragStartEvent) => setDragged((event.active.data.current as DragData | undefined)?.row ?? null)

    const onDragEnd = ({ active, over }: DragEndEvent) => {
        setDragged(null)
        const data = active.data.current as DragData | undefined
        if (!over || !data || data.from === over.id) return
        void move(data.row, data.from, String(over.id))
    }

    if (lanes === null) {
        return (
            <div className="flex gap-3 p-3">
                {[0, 1, 2].map(i => (
                    <Skeleton key={i} className="h-64 w-64 shrink-0" />
                ))}
            </div>
        )
    }

    if (error) return <EmptyState className="h-full" icon={DatabaseIcon} title={t('board.unavailable')} description={error} />
    if (lanes.length === 0) return <EmptyState className="h-full" icon={DatabaseIcon} title={t('browser.noRows')} description={query ? t('browser.noSearchMatch') : t('browser.tableEmpty')} />

    return (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragged(null)}>
            <div className="flex h-full items-start gap-3 overflow-x-auto p-3">
                {lanes.map(lane => (
                    <BoardLane key={lane.key} lane={lane} valueFormat={valueFormat} context={context} onShowMore={() => showMore(lane)}>
                        {lane.rows.map((row, i) => (
                            <BoardCard key={rowKey(row) ?? i} row={row} from={lane.key} onOpen={onOpenRow && (() => onOpenRow(row))}>
                                <BoardItem row={row} fields={fields} formats={formats} context={context} />
                            </BoardCard>
                        ))}
                    </BoardLane>
                ))}
            </div>
            <DragOverlay>{dragged && <BoardItem row={dragged} fields={fields} formats={formats} context={context} className="w-62 cursor-grabbing shadow-lg" />}</DragOverlay>
        </DndContext>
    )
}

function BoardLane({ lane, valueFormat, context, onShowMore, children }: { lane: Lane; valueFormat?: string; context: CellContext; onShowMore: () => void; children: React.ReactNode }) {
    const t = useTranslations('data.board')
    const { setNodeRef, isOver } = useDroppable({ id: lane.key })
    const hidden = lane.total - lane.rows.length

    return (
        <div ref={setNodeRef} className={cn('flex max-h-full w-64 shrink-0 flex-col gap-1.5 rounded-md bg-muted/50 p-1.5 transition-colors', isOver && 'bg-accent ring-1 ring-primary/40')}>
            <BoardColumnHeader value={lane.label} total={lane.total} sum={lane.sum} valueFormat={valueFormat} context={context} />
            <div className="flex min-h-8 flex-col gap-1.5 overflow-y-auto">{children}</div>
            {hidden > 0 && (
                <Button type="button" variant="ghost" size="xs" onClick={onShowMore} className="justify-start text-muted-foreground">
                    {t('showMore', { count: Math.min(hidden, PER_COLUMN) })}
                </Button>
            )}
        </div>
    )
}

function BoardCard({ row, from, onOpen, children }: { row: DbRow; from: string; onOpen?: () => void; children: React.ReactNode }) {
    const id = rowKey(row)
    const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `${from}:${id}`, data: { row, from } satisfies DragData, disabled: id === null })

    return (
        <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen} className={cn(onOpen ? 'cursor-pointer' : 'cursor-grab', 'rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50', isDragging && 'opacity-40')}>
            {children}
        </div>
    )
}
