'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Stripes } from '@rerun/ui/primitives'
import { Icon } from '@/components/ui/icon'
import { IconBadge } from '@/components/ui/icon-badge'
import { CheckIcon, Package, PencilIcon, ShieldCheckIcon, UsersIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { CaptureStep } from './useCaptureFlow'

// The create wizard names the template before it captures anything; the standalone capture starts
// on an existing one, so it passes a capture step and the naming stage simply reads as done.
export type ProgressStep = 'title' | CaptureStep

type StageState = 'upcoming' | 'current' | 'done'

type CaptureStage = {
    step: ProgressStep
    icon: LucideIcon
    points: readonly string[]
}

// What the capture actually does, step by step. The security points are the protections
// `apps/engine/src/agents/archive.ts` applies, so this panel states them rather than promising
// something the pipeline does not do.
const CAPTURE_STAGES: readonly CaptureStage[] = [
    { step: 'title', icon: PencilIcon, points: ['private', 'signed'] },
    { step: 'select', icon: UsersIcon, points: ['snapshot', 'edits'] },
    { step: 'review', icon: ShieldCheckIcon, points: ['env', 'apps', 'scan', 'memories'] },
    { step: 'done', icon: Package, points: ['stored', 'warnings'] },
]

const EDGE_FADE = 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)'

// Right hand column of the capture wizards: the four stages stacked top to bottom, the current one
// always scrolled back to the middle. The step is the only thing that moves the list, so the
// container is `overflow-hidden`: it still scrolls programmatically, just never under the wheel.
export function CaptureProgressPanel({ step }: { step: ProgressStep }) {
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const activeRef = React.useRef<HTMLDivElement>(null)
    // Half the visible height, so the first and the last stage can reach the middle at all: without
    // it `scrollTo` clamps at the ends and only the inner stages would ever centre.
    const [pad, setPad] = React.useState(0)

    React.useEffect(() => {
        const container = scrollRef.current
        if (!container) return
        const observer = new ResizeObserver(() => setPad(container.clientHeight / 2))
        observer.observe(container)
        return () => observer.disconnect()
    }, [])

    React.useEffect(() => {
        const container = scrollRef.current
        const card = activeRef.current
        if (!container || !card || pad === 0) return
        container.scrollTo({ top: card.offsetTop - (container.clientHeight - card.offsetHeight) / 2, behavior: 'smooth' })
    }, [step, pad])

    const activeIndex = CAPTURE_STAGES.findIndex(stage => stage.step === step)

    return (
        <div className="hidden min-h-0 flex-col border-l bg-muted/30 sm:flex">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-hidden px-8" style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}>
                <ol className="relative flex flex-col" style={{ paddingBlock: pad }}>
                    {CAPTURE_STAGES.map((stage, index) => {
                        const state: StageState = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'upcoming'
                        return (
                            <CaptureStageCard
                                key={stage.step}
                                ref={state === 'current' ? activeRef : undefined}
                                stage={stage}
                                state={state}
                                connected={index > 0}
                            />
                        )
                    })}
                </ol>
            </div>
        </div>
    )
}

const CONNECTOR_FADE = 'linear-gradient(to bottom, transparent, rgb(255 255 255 / 0.28), transparent)'

type CaptureStageCardProps = {
    ref?: React.Ref<HTMLDivElement>
    stage: CaptureStage
    state: StageState
    // False on the first stage, which has nothing above it to connect to.
    connected: boolean
}

function CaptureStageCard({ ref, stage, state, connected }: CaptureStageCardProps) {
    const t = useTranslations('templates.capture.stages')
    // The point keys differ per stage, which the typed lookup cannot follow through `stage.step`.
    const point = (key: string) => t(`${stage.step}.points.${key}` as Parameters<typeof t>[0])
    return (
        <li className="flex flex-col">
            {connected && <span aria-hidden className="h-6 w-0.5 self-center rounded-full" style={{ background: CONNECTOR_FADE }} />}

            <div
                ref={ref}
                className={cn(
                    'overflow-hidden rounded-lg border transition-colors duration-300',
                    state === 'current' ? 'border-foreground/20 bg-card' : 'border-border/60 bg-card/40',
                    state === 'upcoming' && 'opacity-60',
                )}
            >
                <div className="relative flex items-center gap-3 overflow-hidden border-b px-4 py-3">
                    <StageStripes state={state} />
                    <Icon icon={state === 'done' ? CheckIcon : stage.icon} size="sm" className="relative" />
                    <p className="relative text-sm font-medium">{t(`${stage.step}.title`)}</p>
                </div>

                <div className="flex flex-col gap-3 p-4">
                    <p className="text-xs text-muted-foreground">{t(`${stage.step}.description`)}</p>

                    <ul className="flex flex-col gap-2">
                        {stage.points.map(key => (
                            <li key={key} className="flex items-center gap-2">
                                <IconBadge tone={state === 'done' ? 'green' : 'neutral'} icon={CheckIcon} glow={false} />
                                <p className="min-w-0 text-xs font-medium">{point(key)}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </li>
    )
}

const STRIPE_COLORS: Record<StageState, string> = {
    upcoming: 'rgb(255 255 255 / 0.03)',
    current: 'rgb(255 255 255 / 0.09)',
    done: 'rgb(34 197 94 / 0.14)',
}

// One layer per state cross-fading rather than a single `Stripes` whose `color` changes: the colour
// is an inline `backgroundImage`, so swapping it would snap instead of transitioning.
function StageStripes({ state }: { state: StageState }) {
    return (
        <>
            {(Object.keys(STRIPE_COLORS) as StageState[]).map(key => (
                <span key={key} className={cn('absolute inset-0 transition-opacity duration-300', state === key ? 'opacity-100' : 'opacity-0')}>
                    <Stripes fade="vertical" color={STRIPE_COLORS[key]} />
                </span>
            ))}
        </>
    )
}
