'use client'

import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
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

// A Box only lands among Boxes. A coworker lands on another coworker, or in a section anywhere the
// pointer is, before its nearest neighbour.
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
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(OwnKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

    const onDragStart = ({ active: started }: DragStartEvent) => setActive(String(started.id))

    const onDragEnd = ({ active: dropped, over }: DragEndEvent) => {
        setActive(null)
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
            const from = source.members.findIndex(member => member.id === moved)
            const to = Math.min(overIndex, source.members.length - 1)
            if (from === to) return
            const arranged = arrayMove(source.members, from, to)
            const others = arranged.filter(member => member.id !== moved).map(member => ({ id: member.id, order: member.sidebarOrder }))
            store.orderAgents(sidebarOrderWrites(others, moved, to), viewer)
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

    return (
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
            <SortableContext items={sections.map(section => boxId(section.box.id))} strategy={verticalListSortingStrategy}>
                {sections.map(section => (
                    <SortableBox
                        key={section.box.id}
                        section={section}
                        draggable={manageable.has(section.box.id)}
                        collapsed={collapsed.includes(section.box.id)}
                        agentDragging={activeKind === 'agent'}
                        onToggle={() => onToggle(section.box.id)}
                        onDialog={kind => onDialog(kind, section.box.id)}
                        renderTile={agent => (
                            <SortableTile key={agent.id} agent={agent} draggable={manageable.has(agent.spaceId)}>
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
    agentDragging: boolean
    onToggle: () => void
    onDialog: (kind: BoxDialogKind) => void
    renderTile: (agent: IsoAgent) => ReactNode
}

function SortableBox({ section, draggable, collapsed, agentDragging, onToggle, onDialog, renderTile }: SortableBoxProps) {
    const { box, members } = section
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: boxId(box.id), disabled: !draggable, attributes: { role: 'group' } })
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropId(box.id) })
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
                drag={{ ref, style: { transform: CSS.Translate.toString(transform), transition }, handle: { ...attributes, ...listeners }, dragging: isDragging, target: agentDragging && isOver }}
            />
        </SortableContext>
    )
}

function SortableTile({ agent, draggable, children }: { agent: IsoAgent; draggable: boolean; children: ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: agentId(agent.id), disabled: !draggable, attributes: { role: 'group' } })
    return (
        <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners} className={cn('rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50', isDragging && 'opacity-40')}>
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
