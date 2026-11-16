'use client'

import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useState, type KeyboardEvent, type ReactNode } from 'react'

import { type BoxDialogKind, SidebarBoxSection } from '@/components/workspace-view/SidebarBoxSection'
import { useBoxViewer, useManageableSpaceIds } from '@/hooks/useBoxAccess'
import type { IsoAgent, SpacePublic } from '@/lib/board/types'
import { ChevronDownIcon } from '@/lib/icons'
import { sidebarOrderWrites, type SidebarSection } from '@/lib/workspace-view'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'

// One id space for dnd-kit: a Box by its header, a coworker by its tile, a Box again as the place a
// coworker is dropped into (its whole section, folded or empty included).
const boxId = (id: string) => `box:${id}`
const agentId = (id: string) => `agent:${id}`
const dropId = (id: string) => `drop:${id}`
const idOf = (dndId: string | number) => String(dndId).slice(String(dndId).indexOf(':') + 1)
const kindOf = (dndId: string | number) => String(dndId).slice(0, String(dndId).indexOf(':'))

// A Box only lands among Boxes. A coworker lands before the coworker under the pointer, or at the end
// of the Box whose section the pointer is in.
const collision: CollisionDetection = args => {
    const draggingBox = kindOf(args.active.id) === 'box'
    const droppableContainers = args.droppableContainers.filter(container => (kindOf(container.id) === 'box') === draggingBox)
    const scoped = { ...args, droppableContainers }
    if (draggingBox) return closestCenter(scoped)
    const under = pointerWithin(scoped)
    const tiles = under.filter(hit => kindOf(hit.id) === 'agent')
    if (tiles.length > 0) return tiles
    return under.length > 0 ? under : closestCenter(scoped)
}

// The keyboard picks an item up only from the item itself: Enter on the coworker's button inside
// still opens it, and Enter on a Box's name still folds it.
class OwnKeyboardSensor extends KeyboardSensor {
    static activators = KeyboardSensor.activators.map(activator => ({
        ...activator,
        handler: (event: KeyboardEvent, ...rest: Parameters<typeof activator.handler> extends [unknown, ...infer Rest] ? Rest : never) => event.target === event.currentTarget && activator.handler(event, ...rest),
    }))
}

type SidebarBoxListProps = {
    sections: SidebarSection<IsoAgent, SpacePublic>[]
    collapsed: readonly string[]
    onToggle: (boxId: string) => void
    onDialog: (kind: BoxDialogKind, boxId: string) => void
    renderTile: (agent: IsoAgent) => ReactNode
}

/** The Simple view's Boxes and their coworkers, in the order the workspace arranged them by dragging. */
export function SidebarBoxList({ sections, collapsed, onToggle, onDialog, renderTile }: SidebarBoxListProps) {
    const viewer = useBoxViewer()
    const manageable = useManageableSpaceIds()
    const [active, setActive] = useState<string | null>(null)
    const [overId, setOverId] = useState<string | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(OwnKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

    const onDragStart = ({ active: started }: DragStartEvent) => setActive(String(started.id))
    const onDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null)
    const endDrag = () => {
        setActive(null)
        setOverId(null)
    }

    const onDragEnd = ({ active: dropped, over }: DragEndEvent) => {
        endDrag()
        if (!over) return
        const store = useBoardStore.getState()
        if (kindOf(dropped.id) === 'box') {
            const boxes = sections.map(section => section.box)
            const from = boxes.findIndex(box => box.id === idOf(dropped.id))
            const to = boxes.findIndex(box => box.id === idOf(over.id))
            if (from < 0 || to < 0 || from === to) return
            const arranged = arrayMove(boxes, from, to)
            const others = arranged.filter(box => box.id !== idOf(dropped.id)).map(box => ({ id: box.id, order: box.sidebar_order }))
            store.orderSpaces(sidebarOrderWrites(others, idOf(dropped.id), to), viewer)
            return
        }

        const moved = idOf(dropped.id)
        const source = sections.find(section => section.members.some(member => member.id === moved))
        const target = kindOf(over.id) === 'agent' ? sections.find(section => section.members.some(member => member.id === idOf(over.id))) : sections.find(section => section.box.id === idOf(over.id))
        if (!source || !target) return
        const overIndex = kindOf(over.id) === 'agent' ? target.members.findIndex(member => member.id === idOf(over.id)) : target.members.length

        if (source.box.id === target.box.id) {
            // Its own Box's name or the gap between two tiles is not a rank: it stays where it was.
            if (kindOf(over.id) !== 'agent') return
            const from = source.members.findIndex(member => member.id === moved)
            if (from === overIndex) return
            const arranged = arrayMove(source.members, from, overIndex)
            const others = arranged.filter(member => member.id !== moved).map(member => ({ id: member.id, order: member.sidebarOrder }))
            store.orderAgents(sidebarOrderWrites(others, moved, overIndex), viewer)
            return
        }

        const others = target.members.map(member => ({ id: member.id, order: member.sidebarOrder }))
        const writes = sidebarOrderWrites(others, moved, overIndex)
        const landing = writes.find(write => write.id === moved)
        store.orderAgents(
            writes.filter(write => write.id !== moved),
            viewer
        )
        store.moveAgentToBox(moved, target.box.id, viewer, landing?.order)
    }

    const activeKind = active ? kindOf(active) : null
    const activeAgent = activeKind === 'agent' ? sections.flatMap(section => section.members).find(member => member.id === idOf(active as string)) : undefined
    const activeBox = activeKind === 'box' ? sections.find(section => section.box.id === idOf(active as string)) : undefined
    // The order of the Boxes is the whole workspace's: moving one renumbers the others.
    const managesEveryBox = sections.every(section => manageable.has(section.box.id))
    // Where a coworker dragged out of its Box would land: that Box lights up, and the tile it would
    // sit before shows a line, since dnd-kit only makes room inside the list the drag started in.
    const overBoxId = !overId ? null : kindOf(overId) === 'agent' ? sections.find(section => section.members.some(member => member.id === idOf(overId)))?.box.id : idOf(overId)
    const landingBoxId = activeAgent && overBoxId && overBoxId !== activeAgent.spaceId ? overBoxId : null
    const landingBeforeId = landingBoxId && overId && kindOf(overId) === 'agent' ? idOf(overId) : null

    return (
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={endDrag}>
            <SortableContext items={sections.map(section => boxId(section.box.id))} strategy={verticalListSortingStrategy}>
                {sections.map(section => (
                    <SortableBox
                        key={section.box.id}
                        section={section}
                        draggable={managesEveryBox}
                        collapsed={collapsed.includes(section.box.id)}
                        landing={landingBoxId === section.box.id}
                        onToggle={() => onToggle(section.box.id)}
                        onDialog={kind => onDialog(kind, section.box.id)}
                        renderTile={agent => (
                            <SortableTile key={agent.id} agent={agent} draggable={manageable.has(agent.spaceId)} landingBefore={landingBeforeId === agent.id}>
                                {renderTile(agent)}
                            </SortableTile>
                        )}
                    />
                ))}
            </SortableContext>
            <DragOverlay>
                {activeAgent && <TileGhost agent={activeAgent} />}
                {activeBox && <BoxGhost section={activeBox} />}
            </DragOverlay>
        </DndContext>
    )
}

type SortableBoxProps = {
    section: SidebarSection<IsoAgent, SpacePublic>
    draggable: boolean
    collapsed: boolean
    landing: boolean
    onToggle: () => void
    onDialog: (kind: BoxDialogKind) => void
    renderTile: (agent: IsoAgent) => ReactNode
}

function SortableBox({ section, draggable, collapsed, landing, onToggle, onDialog, renderTile }: SortableBoxProps) {
    const { box, members } = section
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: boxId(box.id), disabled: !draggable, attributes: { role: 'group' } })
    const { setNodeRef: setDropRef } = useDroppable({ id: dropId(box.id) })
    const ref = (node: HTMLElement | null) => {
        setNodeRef(node)
        setDropRef(node)
    }
    return (
        <SortableContext items={members.map(member => agentId(member.id))} strategy={verticalListSortingStrategy}>
            <SidebarBoxSection
                box={box}
                members={members}
                collapsed={collapsed}
                onToggle={onToggle}
                onDialog={onDialog}
                renderTile={renderTile}
                drag={{ ref, style: { transform: CSS.Translate.toString(transform), transition }, handle: { ...attributes, ...listeners }, dragging: isDragging, target: landing }}
            />
        </SortableContext>
    )
}

function SortableTile({ agent, draggable, landingBefore, children }: { agent: IsoAgent; draggable: boolean; landingBefore: boolean; children: ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: agentId(agent.id), disabled: !draggable, attributes: { role: 'group' } })
    return (
        <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners} className={cn('relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50', isDragging && 'opacity-40')}>
            {landingBefore && <span aria-hidden className="pointer-events-none absolute inset-x-2 -top-0.5 z-10 h-0.5 rounded-full bg-brand" />}
            {children}
        </div>
    )
}

// What follows the pointer: the coworker as it reads in the list, without its line and menus.
function TileGhost({ agent }: { agent: IsoAgent }) {
    return (
        <div className="flex w-68 cursor-grabbing items-center gap-2.5 rounded-lg border border-border bg-background py-2 pr-3 pl-2 shadow-lg">
            <AgentBuddy agentId={agent.id} mood={agent.disabledAt ? 'asleep' : 'idle'} size={32} facing="right" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
        </div>
    )
}

function BoxGhost({ section }: { section: SidebarSection<IsoAgent, SpacePublic> }) {
    const tMenu = useTranslations('builder.contextMenu')
    return (
        <div className="flex h-8 w-68 cursor-grabbing items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground shadow-lg">
            <ChevronDownIcon className="size-3 shrink-0" />
            <span className="truncate">{section.box.name?.trim() || tMenu('untitledBox')}</span>
            <span className="shrink-0 text-muted-foreground/60 tabular-nums">{section.members.length}</span>
        </div>
    )
}
