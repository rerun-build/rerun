'use client'

import { TextShimmer } from '@rerun/ui'
import { IsoGrid, agentTileStyle } from '@rerun/ui/iso-grid'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { planCardScene } from '@/lib/foreman/plan-scene'
import type { PlanLifeBeat, PlanLifeStage } from '@/lib/foreman/plan-life'
import { CircleCheckIcon, InboxIcon, Loader2Icon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { PlanBeats, PlanGroup } from './plan-card'
import { usePlanLife } from './usePlanLife'

const STAGE_LOOK: Record<Exclude<PlanLifeStage, 'rest'>, { icon: LucideIcon; className: string }> = {
    trigger: { icon: InboxIcon, className: 'text-muted-foreground' },
    working: { icon: Loader2Icon, className: 'text-amber-500' },
    delivered: { icon: CircleCheckIcon, className: 'text-emerald-500' },
}

// What the tile is doing, said under the board rather than in a bubble over it: at the card's zoom a
// bubble is too small to read, and it stands on the Box's own name.
function ActivityLine({ beat, tick }: { beat: PlanLifeBeat; tick: number }) {
    const t = useTranslations('foreman.plan')
    const look = beat.stage === 'rest' ? null : STAGE_LOOK[beat.stage]

    return (
        <div className="flex h-9 items-center justify-center border-t border-border/60 px-3 text-xs">
            <AnimatePresence mode="wait">
                {look && beat.line ? (
                    <motion.span
                        key={tick}
                        className={cn('flex min-w-0 items-center gap-1.5', look.className)}
                        initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <look.icon className={cn('size-3.5 shrink-0', beat.stage === 'working' && 'animate-spin')} />
                        <span className="truncate">{beat.stage === 'working' ? <TextShimmer>{beat.line}</TextShimmer> : beat.line}</span>
                    </motion.span>
                ) : (
                    <motion.span key="rest" className="text-muted-foreground/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}>
                        {t('standingBy')}
                    </motion.span>
                )}
            </AnimatePresence>
        </div>
    )
}

// The lone agent of a card playing its day in a loop. It waits for the whole call: a day still being
// written would be read a letter at a time. An item with no day to play, a template or a shared
// agent, simply stands there.
export function PlanLifeScene({ group, script, waiting }: { group: PlanGroup; script: PlanBeats | null; waiting: boolean }) {
    const { beat, tick, animated } = usePlanLife(script, waiting)
    const scene = useMemo(() => planCardScene(group, { animated }), [group, animated])
    const name = group.items[0].name

    const tiles = useMemo(() => scene.tiles.map((tile, rank) => (rank === 0 ? { ...tile, style: agentTileStyle(beat.status, name) } : tile)), [scene, beat.status, name])

    return (
        <div className="overflow-hidden rounded-lg bg-background/60">
            <div className="pointer-events-none relative h-44">
                <IsoGrid tiles={tiles} containers={scene.containers} selectedTileId={null} selectedContainerId={null} fitToContent mask={false} scrollGestures={false} className="absolute inset-0" />
            </div>
            {script && <ActivityLine beat={beat} tick={tick} />}
        </div>
    )
}
