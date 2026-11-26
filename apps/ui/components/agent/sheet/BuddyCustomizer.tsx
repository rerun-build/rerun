'use client'

import { AgentBuddy, FrontBuddy, type BuddyMood } from '@rerun/ui/iso-grid'
import { ScrollFade } from '@rerun/ui/primitives'
import { useIsMobile } from '@rerun/ui/primitives/use-is-mobile'
import { useTranslations } from 'next-intl'
import { useState, type ComponentProps, type CSSProperties } from 'react'

import { CoworkerLookPicker } from '@/components/agent/CoworkerLookPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import type { IsoAgent } from '@/lib/board/types'
import { PaintbrushIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'

const SIZE = 116
const LIFT = 'translateY(-12px)'
const TURN_MS = 240
const EASE_IN = 'cubic-bezier(0.5, 0, 0.75, 0)'
const SPRING = 'cubic-bezier(0.2, 0.9, 0.25, 1.3)'

type StandingBuddyProps = {
    agentId: string
    mood: BuddyMood
    // Hovered or focused: it stands up, turns to face you and loses its paint, a figurine waiting
    // for its colours.
    active: boolean
    // The editor is open: it stays up and facing you, back in colour to show each choice on it.
    editing: boolean
}

// The iso block turns away first, then the front view turns in, a little higher; leaving plays it
// backwards. With reduced motion only the paint changes. Standing to be dressed, it is awake and in
// its own colour whatever it is doing on the board, so every choice reads on it.
function StandingBuddy({ agentId, mood, active, editing }: StandingBuddyProps) {
    const up = active || editing
    const sketch = active && !editing
    const side = SIZE + 24

    const isoTurn: CSSProperties = {
        transform: up ? `${LIFT} rotateY(-90deg)` : 'rotateY(0deg)',
        transition: `transform ${TURN_MS}ms ${EASE_IN} ${up ? 0 : TURN_MS}ms, opacity 0ms linear ${TURN_MS}ms`,
        opacity: up ? 0 : 1,
        backfaceVisibility: 'hidden',
    }
    const frontTurn: CSSProperties = {
        transform: up ? `${LIFT} rotateY(0deg)` : 'rotateY(90deg)',
        transition: `transform ${up ? TURN_MS * 1.8 : TURN_MS}ms ${up ? SPRING : EASE_IN} ${up ? TURN_MS : 0}ms, opacity 0ms linear ${TURN_MS}ms, filter 380ms ease ${up ? TURN_MS * 1.6 : 0}ms`,
        opacity: up ? 1 : 0,
        backfaceVisibility: 'hidden',
        filter: sketch ? 'grayscale(1) contrast(0.8) brightness(1.2)' : 'none',
    }

    return (
        <span className="relative flex items-center justify-center [perspective:700px] motion-reduce:[&_*]:!transition-none" style={{ width: side, height: side }}>
            <span
                aria-hidden
                className={cn('absolute inset-0 rounded-2xl transition-opacity duration-300', up ? 'opacity-100' : 'opacity-0')}
                style={{
                    backgroundImage: 'radial-gradient(color-mix(in srgb, var(--foreground) 22%, transparent) 1px, transparent 1px)',
                    backgroundSize: '10px 10px',
                    maskImage: 'radial-gradient(closest-side, black 55%, transparent)',
                }}
            />
            <SketchCorners shown={up} />
            <span aria-hidden className={cn('pointer-events-none absolute bottom-2 left-1/2 h-4 -translate-x-1/2 rounded-[50%] border border-dashed border-foreground/35 transition-all duration-500', up ? 'w-[56%] opacity-100' : 'w-[40%] opacity-0')} />
            <span className="absolute inset-0 flex items-center justify-center" style={isoTurn}>
                <AgentBuddy agentId={agentId} mood={mood} size={SIZE} facing="left" alive closesEyesAtRest />
            </span>
            <span className="absolute inset-0 flex items-center justify-center" style={frontTurn}>
                <FrontBuddy agentId={agentId} size={SIZE} />
            </span>
        </span>
    )
}

function SketchCorners({ shown }: { shown: boolean }) {
    const corner = 'absolute size-3 border-foreground/50'
    return (
        <span aria-hidden className={cn('pointer-events-none absolute transition-all duration-300', shown ? 'inset-1 opacity-100' : 'inset-3 opacity-0')}>
            <span className={cn(corner, 'start-0 top-0 rounded-ss-md border-s border-t')} />
            <span className={cn(corner, 'end-0 top-0 rounded-se-md border-e border-t')} />
            <span className={cn(corner, 'bottom-0 start-0 rounded-es-md border-b border-s')} />
            <span className={cn(corner, 'bottom-0 end-0 rounded-ee-md border-b border-e')} />
        </span>
    )
}

type BuddyCustomizerProps = {
    agent: IsoAgent
    mood: BuddyMood
    // Why it cannot be changed, when it cannot: the buddy stays still and says it in a tooltip.
    lockedReason?: string
}

// The coworker's buddy on its card is where its look is changed: it stands up to be dressed when the
// pointer comes, and a click opens the editor under it, in a sheet on a phone.
export function BuddyCustomizer({ agent, mood, lockedReason }: BuddyCustomizerProps) {
    const t = useTranslations('agent.agentCard')
    const narrow = useIsMobile()
    const setAgentLook = useBoardStore(s => s.setAgentLook)
    const [open, setOpen] = useState(false)
    const [hovered, setHovered] = useState(false)
    const locked = !!lockedReason
    const active = hovered && !locked
    const editing = open && !locked
    const undressed = agent.look == null

    const editor = <CoworkerLookPicker agentId={agent.id} look={agent.look ?? null} onChange={look => setAgentLook(agent.id, look)} layout="tabs" />

    const button = (props: ComponentProps<'button'>) => (
        <button
            type="button"
            aria-label={t('customizeName', { name: agent.name })}
            disabled={locked}
            onPointerEnter={event => event.pointerType === 'mouse' && setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={event => event.currentTarget.matches(':focus-visible') && setHovered(true)}
            onBlur={() => setHovered(false)}
            className="relative flex flex-col items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            {...props}
        >
            {undressed && !locked && !active && !editing && (
                <span className="pointer-events-none absolute -top-2 start-[58%] z-10 whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium text-background shadow-md motion-safe:animate-[bounce_2.4s_ease-in-out_3]">
                    {t('customizeMe')}
                    <span className="absolute -bottom-1 start-3 size-2 rotate-45 bg-foreground" />
                </span>
            )}
            <StandingBuddy agentId={agent.id} mood={mood} active={active} editing={editing} />
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                <span
                    className={cn(
                        'pointer-events-none flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background shadow-md transition-all duration-300',
                        active && !editing ? 'translate-y-0 opacity-100 delay-300' : '-translate-y-1 opacity-0',
                    )}
                >
                    <PaintbrushIcon className="size-3" />
                    {t('customize')}
                </span>
            </span>
        </button>
    )

    if (narrow) {
        return (
            <>
                <TooltipDisabledReason reason={lockedReason}>{button({ onClick: () => setOpen(true) })}</TooltipDisabledReason>
                <Sheet open={editing} onOpenChange={setOpen}>
                    <SheetContent side="bottom" className="max-h-[80dvh] gap-0 rounded-t-2xl p-0">
                        <SheetHeader className="pb-1">
                            <SheetTitle>{t('lookTitle', { name: agent.name })}</SheetTitle>
                            <SheetDescription className="sr-only">{t('lookDescription')}</SheetDescription>
                        </SheetHeader>
                        <ScrollFade className="min-h-0 flex-1 px-4 pb-4">{editor}</ScrollFade>
                    </SheetContent>
                </Sheet>
            </>
        )
    }

    return (
        <TooltipDisabledReason reason={lockedReason}>
            <Popover open={editing} onOpenChange={setOpen}>
                <PopoverTrigger asChild>{button({})}</PopoverTrigger>
                <PopoverContent side="bottom" align="center" aria-label={t('lookTitle', { name: agent.name })} className="w-[340px] max-w-[calc(100vw-24px)] p-0">
                    <ScrollFade className="max-h-[min(520px,var(--radix-popover-content-available-height))] p-3">{editor}</ScrollFade>
                </PopoverContent>
            </Popover>
        </TooltipDisabledReason>
    )
}
