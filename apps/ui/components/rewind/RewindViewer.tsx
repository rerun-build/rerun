'use client'

import type { RewindPayload } from '@rerun/contracts'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { ChevronLeft, ChevronRight, PauseIcon, XIcon } from '@/lib/icons'
import { rewindSlides, type RewindSlideId } from '@/lib/rewind/slides'
import { useCoverBoard } from '@/stores/board-cover.store'
import { useRewindStore } from '@/stores/rewind.store'
import { RewindProgress } from './RewindProgress'
import { RewindWeekPicker } from './RewindWeekPicker'
import { AwardsSlide } from './slides/AwardsSlide'
import { ClockSlide } from './slides/ClockSlide'
import { ConnectorsSlide } from './slides/ConnectorsSlide'
import { HighlightsSlide } from './slides/HighlightsSlide'
import { HoursSlide } from './slides/HoursSlide'
import { IntroSlide } from './slides/IntroSlide'
import { MemorySlide } from './slides/MemorySlide'
import { MvpSlide } from './slides/MvpSlide'
import { OutroSlide } from './slides/OutroSlide'
import { RhythmSlide } from './slides/RhythmSlide'
import type { RewindSlideProps } from './slides/types'
import { useStoryPlayer } from './useStoryPlayer'

const SLIDE_DURATION_MS = 6500
// A press shorter than this is a tap and moves the story; anything longer was a hold to read.
const TAP_MAX_MS = 250
const PREV_ZONE_SHARE = 0.3

const SLIDES: Record<RewindSlideId, ComponentType<RewindSlideProps>> = {
    intro: IntroSlide,
    hours: HoursSlide,
    rhythm: RhythmSlide,
    clock: ClockSlide,
    mvp: MvpSlide,
    connectors: ConnectorsSlide,
    highlights: HighlightsSlide,
    memory: MemorySlide,
    awards: AwardsSlide,
    outro: OutroSlide,
}

// Slides lay themselves out from the card's shape through the `rewind-wide` variant.
const STORY_CONTAINER: CSSProperties = { containerType: 'size', containerName: 'rewind' }
// Same rule as the `rewind-wide` variant in globals.css (40rem, wider than tall).
const WIDE_MIN_WIDTH_PX = 640

function isWideStory(width: number, height: number) {
    return width >= WIDE_MIN_WIDTH_PX && width > height
}

const subscribeNothing = () => () => {}

export function RewindViewer() {
    const shown = useRewindStore(s => s.shown)
    const closeRewind = useRewindStore(s => s.closeRewind)
    const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false)
    if (!onClient) return null

    return createPortal(
        <AnimatePresence>{shown && <RewindStory key={shown.id ?? 'preview'} rewindId={shown.id} payload={shown.payload} onClose={closeRewind} />}</AnimatePresence>,
        document.body
    )
}

// `rewindId` is null for a story with no stored week behind it; it then has no history to pick from.
export function RewindStory({ rewindId = null, payload, onClose, startAt = 0 }: { rewindId?: string | null; payload: RewindPayload; onClose: () => void; startAt?: number }) {
    useCoverBoard()
    const t = useTranslations('rewind.viewer')
    const slides = useMemo(() => rewindSlides(payload), [payload])
    const player = useStoryPlayer(slides.length, SLIDE_DURATION_MS, startAt)
    const [replays, setReplays] = useState(0)
    const pressStart = useRef(0)
    const pickerOpen = useRef(false)
    const { next, prev, goTo, setHeld } = player
    const hasHistory = useRewindStore(s => s.weeks.length > 1)
    const pickableId = hasHistory ? rewindId : null
    const [wide, setWide] = useState(false)
    const measureStory = useCallback((node: HTMLDivElement | null) => {
        if (!node) return
        const observer = new ResizeObserver(([entry]) => setWide(isWideStory(entry.contentRect.width, entry.contentRect.height)))
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    const names = useMemo(() => new Map(payload.agents.map(agent => [agent.agentId, agent.name])), [payload.agents])
    const agentName = useCallback((agentId: string) => names.get(agentId) ?? t('fallbackAgentName'), [names, t])
    const replay = useCallback(() => {
        setReplays(count => count + 1)
        goTo(0)
    }, [goTo])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (pickerOpen.current) return
            if (event.key === 'Escape') onClose()
            else if (event.key === 'ArrowRight' || event.key === ' ') {
                event.preventDefault()
                next()
            } else if (event.key === 'ArrowLeft') prev()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [next, onClose, prev])

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest('button, a')) return
        pressStart.current = performance.now()
        setHeld(true)
    }

    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (!pressStart.current) return
        const pressedFor = performance.now() - pressStart.current
        pressStart.current = 0
        setHeld(false)
        if (pressedFor > TAP_MAX_MS) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX - bounds.left < bounds.width * PREV_ZONE_SHARE) prev()
        else next()
    }

    const onPickerOpenChange = (open: boolean) => {
        pickerOpen.current = open
        setHeld(open)
    }

    const onPointerCancel = () => {
        pressStart.current = 0
        setHeld(false)
    }

    const slideId = slides[player.index]
    const Slide = SLIDES[slideId]

    return (
        <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('label')}
            className="dark fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/85 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
        >
            {pickableId && <RewindWeekPicker currentId={pickableId} onOpenChange={onPickerOpenChange} className="hidden sm:flex story-landscape:hidden" />}

            <div className="flex h-full w-full items-center justify-center sm:h-auto sm:w-auto">
                <button type="button" aria-label={t('previous')} onClick={prev} className="mr-6 hidden size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:flex">
                    <ChevronLeft className="size-5" />
                </button>

                <motion.div
                    className="relative h-full w-full touch-none overflow-hidden bg-black select-none sm:aspect-[9/16] sm:h-[min(84vh,820px)] sm:w-auto sm:rounded-[28px] sm:shadow-2xl sm:shadow-black/60 story-landscape:aspect-auto story-landscape:h-[min(100dvh-6rem,760px)] story-landscape:w-[min(100vw-10rem,1200px)] story-landscape:rounded-[32px]"
                    initial={{ scale: 0.92, y: 24 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.92, y: 24 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onPointerLeave={onPointerCancel}
                >
                    <div ref={measureStory} className="absolute inset-0" style={STORY_CONTAINER}>
                        <AnimatePresence initial={false}>
                            <motion.div
                                key={`${slideId}-${replays}`}
                                className="absolute inset-0"
                                initial={{ opacity: 0, scale: 1.04 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <Slide payload={payload} agentName={agentName} onReplay={replay} onClose={onClose} wide={wide} />
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/40 to-transparent px-4 pt-4 pb-6">
                        <RewindProgress count={slides.length} index={player.index} progress={player.progress} />
                        <div className="mt-3 flex items-center justify-between text-white">
                            <span className="flex items-center gap-1.5 text-sm font-semibold">
                                {pickableId ? (
                                    <>
                                        <span className="hidden sm:inline">Rewind</span>
                                        <RewindWeekPicker currentId={pickableId} onOpenChange={onPickerOpenChange} className="sm:hidden story-landscape:flex" />
                                    </>
                                ) : (
                                    'Rewind'
                                )}
                                <AnimatePresence>
                                    {player.paused && (
                                        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                            <PauseIcon className="size-3.5 text-white/70" />
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                            </span>
                            <button type="button" aria-label={t('close')} onClick={onClose} className="pointer-events-auto flex size-8 items-center justify-center rounded-full bg-black/30 transition-colors hover:bg-black/50">
                                <XIcon className="size-4" />
                            </button>
                        </div>
                    </div>
                </motion.div>

                <button type="button" aria-label={t('next')} onClick={next} className="ml-6 hidden size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:flex">
                    <ChevronRight className="size-5" />
                </button>
            </div>
        </motion.div>
    )
}
