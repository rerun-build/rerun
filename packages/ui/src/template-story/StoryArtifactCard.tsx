'use client'

import type { TemplateStoryArtifact } from '@rerun/contracts'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { BorderBeam, type BorderBeamProps } from '../BorderBeam'
import { cn } from '../cn'
import { Check, HandIcon } from '../icons'
import { Badge } from '../primitives/badge'
import { Icon } from '../primitives/icon'
import { SpinnerIcon } from '../primitives/spinner'
import { TextShimmer } from '../TextShimmer'
import { useActionTicker } from './useActionTicker'
import { useKitTranslations } from '../locale'

const ENTER = { duration: 0.36, ease: [0.22, 1, 0.36, 1] as const }
const LEAVE = { duration: 0.22, ease: [0.4, 0, 1, 1] as const }
const TICK = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const }

// The stem runs from the card down towards its tile, and stops short of it: over a waiting agent the
// card floats higher to clear the raised hand, which a stem down to the tile would cross.
const STEM_PX = 38

export type StoryCardHeader = { name: string; icon: string | null }

export type StoryArtifactPlacement = {
    key: string
    x: number
    y: number
    // How far above the anchor the card's bottom edge floats, in screen pixels.
    lift: number
    // Screen scale of the card: below 1 on a frame too narrow to hold it at full size.
    scale: number
    header: StoryCardHeader
    actions: readonly string[]
    result: TemplateStoryArtifact | null
}

type CardState = 'running' | 'approval' | 'success' | 'done'

// Same colours as the tiles: amber while the agent works, cyan when it waits for you, green once done.
const STATE: Record<CardState, { tone: NonNullable<BorderBeamProps['tone']>; beam: NonNullable<BorderBeamProps['tone']>; stem: string }> = {
    running: { tone: 'orange', beam: 'orange', stem: 'rgb(249 115 22)' },
    approval: { tone: 'cyan', beam: 'cyan', stem: 'rgb(34 211 238)' },
    success: { tone: 'green', beam: 'green', stem: 'rgb(52 211 153)' },
    done: { tone: 'green', beam: 'neutral', stem: 'color-mix(in oklab, var(--foreground) 45%, transparent)' },
}

function cardState(result: TemplateStoryArtifact | null, running: boolean): CardState {
    if (running) return 'running'
    if (result?.tone === 'approval') return 'approval'
    if (result?.tone === 'success') return 'success'
    return 'done'
}

// What the agent is doing, laid over the grid's world layer so it follows the camera. Same two nodes
// as TourModelPills: the outer one holds the anchor and the counter-scale that keeps the card the
// same size on screen whatever the zoom, the inner one owns the entrance. On one node the
// counter-scale would fight the pop.
export function StoryArtifactLayer({
    artifact,
    zoom,
    playing,
    reducedMotion,
}: {
    artifact: StoryArtifactPlacement | null
    zoom: number
    playing: boolean
    reducedMotion: boolean
}) {
    return (
        <AnimatePresence>
            {artifact && (
                <motion.div
                    key={artifact.key}
                    aria-hidden
                    style={{ position: 'absolute', left: artifact.x, top: artifact.y, translate: '-50% -100%', transformOrigin: '50% 100%', pointerEvents: 'none', zIndex: 999000 }}
                    animate={{ scale: artifact.scale / zoom }}
                    transition={{ duration: 0.15 }}
                >
                    <motion.div
                        style={{ marginBottom: artifact.lift / artifact.scale }}
                        initial={{ opacity: 0, scale: 0.9, y: 10, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: { ...ENTER, delay: 0.35 } }}
                        exit={{ opacity: 0, scale: 0.96, y: -8, filter: 'blur(3px)', transition: LEAVE }}
                    >
                        <StoryActivityCard header={artifact.header} actions={artifact.actions} result={artifact.result} playing={playing} reducedMotion={reducedMotion} />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// The card pinned to the top of a frame too short to float it over its tile: a phone, a narrow column.
// It leaves the anchor behind, so it drops its stem too.
export function StoryDockedCard({
    artifact,
    top,
    playing,
    reducedMotion,
}: {
    artifact: StoryArtifactPlacement | null
    top: number
    playing: boolean
    reducedMotion: boolean
}) {
    return (
        <AnimatePresence>
            {artifact && (
                <motion.div
                    key={artifact.key}
                    aria-hidden
                    className="pointer-events-none absolute left-1/2"
                    style={{ top, translate: '-50% 0', scale: artifact.scale, transformOrigin: '50% 0' }}
                    initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { ...ENTER, delay: 0.35 } }}
                    exit={{ opacity: 0, y: -8, filter: 'blur(3px)', transition: LEAVE }}
                >
                    <StoryActivityCard header={artifact.header} actions={artifact.actions} result={artifact.result} playing={playing} reducedMotion={reducedMotion} stem={false} />
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// The card over the tile: the service (or the agent) and its status on top, then one line that rolls
// through the step's actions, each pushing the last one out, and settles on what the step produced.
export function StoryActivityCard({
    header,
    actions,
    result,
    playing = true,
    reducedMotion = false,
    stem = true,
    className,
}: {
    header: StoryCardHeader
    actions: readonly string[]
    result: TemplateStoryArtifact | null
    playing?: boolean
    reducedMotion?: boolean
    stem?: boolean
    className?: string
}) {
    const t = useKitTranslations()
    const told = useActionTicker(actions.length, playing, reducedMotion)
    const running = told < actions.length
    const state = cardState(result, running)
    const look = STATE[state]

    return (
        <div className={cn('relative w-64 text-left', className)}>
            <div
                className="relative overflow-hidden rounded-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_16px_36px_-18px_rgb(0_0_0/0.3)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_18px_40px_-16px_rgb(0_0_0/0.8)]"
                style={{ background: 'color-mix(in oklab, var(--foreground) 4%, var(--background))' }}
            >
                <BorderBeam pattern="arcs" tone={look.beam} animated={state === 'running' || state === 'approval'} glow={state !== 'done'} duration={4} />

                <div className="relative flex items-center gap-2 px-3 pt-2.5 pb-2">
                    {header.icon && <Icon size="xs" src={header.icon} />}
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-[0.14em] text-foreground/55 uppercase">{header.name}</span>
                    <Badge
                        size="xs"
                        tone={look.tone}
                        glow={false}
                        leading={
                            state === 'running' ? (
                                <SpinnerIcon className="size-2.5 animate-spin" />
                            ) : state === 'approval' ? (
                                <HandIcon className="size-2.5" />
                            ) : (
                                <Check className="size-2.5" />
                            )
                        }
                    >
                        {t(`templateStory.states.${state}`)}
                    </Badge>
                </div>

                <div className="relative mx-3 h-px bg-foreground/[0.07]" />

                <div className="relative h-[46px] overflow-hidden px-3">
                    <AnimatePresence initial={false}>
                        <TickLine key={running ? `action-${told}` : 'result'}>
                            {running ? (
                                <RunningLine action={actions[told] ?? ''} told={told} count={actions.length} />
                            ) : result ? (
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-medium text-foreground">{result.title}</p>
                                        {result.line && <p className="mt-0.5 truncate text-[11px] text-foreground/55">{result.line}</p>}
                                    </div>
                                    {result.tone === 'approval' && (
                                        <div className="flex shrink-0 gap-1">
                                            <span className="rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background shadow-[var(--relief-solid)]">{t('templateStory.approve')}</span>
                                            <span className="rounded-md bg-foreground/[0.06] px-2 py-1 text-[10px] font-medium text-foreground shadow-[var(--relief-subtle)]">{t('templateStory.edit')}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-foreground">
                                    <Check className="size-3.5 shrink-0 text-emerald-500" />
                                    {actions.at(-1)}
                                </p>
                            )}
                        </TickLine>
                    </AnimatePresence>
                </div>

            </div>

            {stem && (
            <span aria-hidden className="absolute top-full left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ height: STEM_PX }}>
                <span className="w-px flex-1 transition-[background] duration-300" style={{ background: `linear-gradient(to bottom, ${look.stem}, transparent)` }} />
                <span className="size-1 rounded-full opacity-70" style={{ background: look.stem, boxShadow: `0 0 6px ${look.stem}` }} />
            </span>
            )}
        </div>
    )
}

// One line of the card's single-line window: it comes up from below and leaves through the top.
function TickLine({ children }: { children: ReactNode }) {
    return (
        <motion.div
            className="absolute inset-x-3 top-0 flex h-full flex-col justify-center"
            initial={{ y: 18, opacity: 0, filter: 'blur(3px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)', transition: TICK }}
            exit={{ y: -18, opacity: 0, filter: 'blur(3px)', transition: { ...TICK, duration: 0.3 } }}
        >
            {children}
        </motion.div>
    )
}

function RunningLine({ action, told, count }: { action: string; told: number; count: number }) {
    return (
        <>
            <div className="flex min-w-0 items-center gap-2">
                <SpinnerIcon className="size-3 shrink-0 animate-spin text-orange-500" />
                <TextShimmer className="max-w-full truncate text-[13px] font-medium [--shimmer-base:color-mix(in_oklab,var(--foreground)_72%,transparent)]" duration={1.4} spread={20}>
                    {action}
                </TextShimmer>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
                <div className="flex flex-1 gap-0.5">
                    {Array.from({ length: count }, (_, index) => (
                        <span key={index} className={cn('h-[3px] flex-1 rounded-full transition-colors duration-300', index <= told ? 'bg-orange-500/80' : 'bg-foreground/10')} />
                    ))}
                </div>
                <span className="font-mono text-[9px] text-foreground/40 tabular-nums">
                    {told + 1}/{count}
                </span>
            </div>
        </>
    )
}
