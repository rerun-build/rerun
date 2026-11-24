'use client'

import { StepFrame } from '@/components/onboarding/welcome/StepFrame'
import { ViewModeSwitch } from '@/components/workspace-view/ViewModeSwitch'
import { BoxIcon, CheckIcon, PanelLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { WorkspaceView } from '@/lib/workspace-view'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const OPTIONS = [
    { value: 'board', icon: BoxIcon },
    { value: 'simple', icon: PanelLeftIcon },
] as const satisfies readonly { value: WorkspaceView; icon: typeof BoxIcon }[]

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

// The tiles are the answer: a pick moves on by itself, so the step has no Continue button. The
// switch under them only shows where the choice is found later, following the tile under the pointer.
export function ViewStep({ onPick, onBack, error }: { onPick: (view: WorkspaceView) => Promise<boolean>; onBack: () => void; error: string | null }) {
    const t = useTranslations('onboarding.view')
    const tView = useTranslations('workspaceView.switch')
    const [picked, setPicked] = useState<WorkspaceView | null>(null)
    const [hovered, setHovered] = useState<WorkspaceView | null>(null)

    const pick = async (view: WorkspaceView) => {
        setPicked(view)
        if (!(await onPick(view))) setPicked(null)
    }

    return (
        <StepFrame title={t('title')} onBack={onBack} error={error}>
            <div role="radiogroup" aria-label={t('title')} className="grid grid-cols-2 gap-2">
                {OPTIONS.map(option => {
                    const selected = picked === option.value
                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            data-selected={selected}
                            disabled={picked !== null}
                            onClick={() => void pick(option.value)}
                            onPointerEnter={() => setHovered(option.value)}
                            onPointerLeave={() => setHovered(null)}
                            onFocus={() => setHovered(option.value)}
                            onBlur={() => setHovered(null)}
                            className={TILE}
                        >
                            {option.value === 'board' ? <BoardDrawing /> : <ClassicDrawing />}
                            <span className="flex items-center gap-1.5 px-1 pb-0.5 text-sm text-muted-foreground group-data-[selected=true]:text-foreground">
                                <option.icon className="size-3.5" />
                                {tView(option.value)}
                            </span>
                            <PickedMark selected={selected} />
                        </button>
                    )
                })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{t('hint')}</span>
                <ViewModeSwitch value={picked ?? hovered ?? 'board'} className="scale-90" />
            </div>
        </StepFrame>
    )
}
