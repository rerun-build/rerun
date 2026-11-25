'use client'

import { CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { WorkspaceView } from '@/lib/workspace-view'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@rerun/ui/primitives'
import type { ComponentProps, ComponentType, ReactNode } from 'react'

const TILE = cn(PANEL_CARD, PANEL_CARD_INTERACTIVE, 'group relative flex flex-col gap-2 p-2 text-start focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-default data-[selected=true]:border-foreground/40 data-[selected=true]:bg-accent')

// The ids only pick each buddy's colours.
const BOARD_BUDDIES = [
    { id: 'lab-nova', left: '30%', top: '30%', mood: 'working' },
    { id: 'lab-atlas', left: '58%', top: '42%', mood: 'idle' },
    { id: 'lab-iris', left: '40%', top: '58%', mood: 'waiting' },
] as const

const LIST_BUDDIES = BOARD_BUDDIES.map(buddy => buddy.id)

function BoardDrawing() {
    return (
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg border bg-muted/50">
            <div className="absolute top-1/2 left-1/2 w-[58%] -translate-x-1/2 -translate-y-1/2">
                <div
                    className="aspect-square rounded-md border border-foreground/20 bg-background/60"
                    style={{
                        transform: 'rotateX(60deg) rotateZ(45deg)',
                        backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
                        backgroundSize: '25% 25%',
                    }}
                />
            </div>
            {BOARD_BUDDIES.map(buddy => (
                <div key={buddy.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: buddy.left, top: buddy.top }}>
                    <AgentBuddy agentId={buddy.id} size={34} mood={buddy.mood} alive />
                </div>
            ))}
        </div>
    )
}

function ClassicDrawing() {
    return (
        <div className="flex aspect-[16/10] overflow-hidden rounded-lg border bg-background">
            <div className="flex w-[38%] flex-col gap-1.5 border-e bg-muted/50 p-1.5">
                {LIST_BUDDIES.map((id, index) => (
                    <div key={id} className={cn('flex items-center gap-1 rounded-md p-1', index === 0 && 'bg-background')}>
                        <AgentBuddy agentId={id} size={16} animated={false} />
                        <div className="flex-1 space-y-1">
                            <div className="h-1 w-4/5 rounded-full bg-foreground/30" />
                            <div className="h-1 w-3/5 rounded-full bg-foreground/15" />
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-1 flex-col justify-end gap-1.5 p-2">
                <div className="h-3 w-4/5 rounded-md bg-muted" />
                <div className="h-3 w-3/5 rounded-md bg-muted" />
                <div className="ms-auto h-3 w-1/2 rounded-md bg-bubble" />
                <div className="mt-1 h-4 rounded-md border" />
            </div>
        </div>
    )
}

function PickedMark({ selected }: { selected: boolean }) {
    return (
        <span className={cn('absolute top-3 end-3 flex size-5 items-center justify-center rounded-full bg-foreground text-background transition-opacity', selected ? 'opacity-100' : 'opacity-0')}>
            <CheckIcon className="size-3" />
        </span>
    )
}

// One view to pick, drawn small, with its name, a check once picked, and whatever the step says of it.
export function ViewTile({ view, icon: ViewIcon, label, selected, children, ...props }: Omit<ComponentProps<'button'>, 'className'> & { view: WorkspaceView; icon: ComponentType<{ className?: string }>; label: ReactNode; selected: boolean }) {
    return (
        <button type="button" role="radio" aria-checked={selected} data-selected={selected} className={TILE} {...props}>
            {view === 'board' ? <BoardDrawing /> : <ClassicDrawing />}
            <span className="flex items-center gap-1.5 px-1 pb-0.5 text-sm text-muted-foreground group-data-[selected=true]:text-foreground">
                <ViewIcon className="size-3.5" />
                {label}
            </span>
            {children}
            <PickedMark selected={selected} />
        </button>
    )
}
