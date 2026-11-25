'use client'

import { PanelCaption } from '@/components/onboarding/panels/OnboardingPanel'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { DoneSlide, TaskSlide } from './ChatSlides'
import { ConnectSlide } from './ConnectSlide'
import { CreateSlide } from './CreateSlide'

const CHAPTERS = [
    { id: 'connect', Slide: ConnectSlide },
    { id: 'create', Slide: CreateSlide },
    { id: 'task', Slide: TaskSlide },
    { id: 'done', Slide: DoneSlide },
] as const satisfies readonly { id: string; Slide: ComponentType }[]

const HOLD_MS = 10_000
const TICK_MS = 200

// The panel of the sign-in: what Rerun does in four chapters, one picture and one headline at a time,
// all four named at the foot.
export function Showcase() {
    const t = useTranslations('onboarding.showcase')
    const [index, setIndex] = useState(0)
    const { id, Slide } = CHAPTERS[index]
    const next = useCallback(() => setIndex(current => (current + 1) % CHAPTERS.length), [])

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 px-8 pt-8 pb-6">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }} className="h-full">
                        <Slide />
                    </motion.div>
                </AnimatePresence>
            </div>
            <div className="shrink-0 space-y-6 px-8 pb-8">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                        <PanelCaption title={t(`${id}.title`)} line={t(`${id}.line`)} />
                    </motion.div>
                </AnimatePresence>
                <ChapterTabs index={index} onPick={setIndex} onEnd={next} />
            </div>
        </div>
    )
}

// The tabs are also the clock: the bar over the open chapter fills while it shows. It ticks here
// alone, so the pictures above never redraw with it, and stands still for reduced motion.
function ChapterTabs({ index, onPick, onEnd }: { index: number; onPick: (index: number) => void; onEnd: () => void }) {
    const t = useTranslations('onboarding.showcase')
    const still = useReducedMotion()
    const [clock, setClock] = useState({ index, percent: 0 })
    const elapsed = clock.index === index ? clock.percent : 0

    useEffect(() => {
        if (still) return
        const startedAt = performance.now()
        const timer = setInterval(() => {
            if (document.hidden) return
            const percent = ((performance.now() - startedAt) / HOLD_MS) * 100
            if (percent >= 100) return onEnd()
            setClock({ index, percent })
        }, TICK_MS)
        return () => clearInterval(timer)
    }, [still, index, onEnd])

    return (
        <div className="flex gap-4">
            {CHAPTERS.map((chapter, position) => {
                const current = position === index
                return (
                    <button key={chapter.id} type="button" aria-pressed={current} onClick={() => onPick(position)} className="group flex min-w-0 flex-1 flex-col gap-2 rounded-sm text-start focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
                        <span aria-hidden className="block w-full">
                            <Progress size="md" value={current ? (still ? 100 : elapsed) : position < index ? 100 : 0} />
                        </span>
                        <span className={cn('truncate text-xs transition-colors', current ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>{t(`${chapter.id}.tab`)}</span>
                    </button>
                )
            })}
        </div>
    )
}
