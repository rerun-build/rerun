'use client'

import { IsoGrid } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { planLifeScript } from '@/lib/foreman/plan-life'
import { planCardScene } from '@/lib/foreman/plan-scene'
import { ChevronLeftIcon, ChevronRightIcon, CircleCheckIcon, ClockIcon, MinusIcon, PencilIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { readPlan, type PlanGroup, type PlanItem } from './plan-card'
import { PlanLifeScene } from './PlanLifeScene'

export type PlanAnswer = { answered: true; confirmed: boolean } | { answered: false }

type PlanCardWidgetProps = {
    input: unknown
    output?: unknown
    streaming?: boolean
    onAnswer: (answer: PlanAnswer) => void
}

const CARD_GAP = 12
const EDGE_FADE = 40

function readOutput(output: unknown): PlanAnswer | null {
    if (!output || typeof output !== 'object') return null
    const value = output as Record<string, unknown>
    if (value.answered !== true) return { answered: false }
    return { answered: true, confirmed: value.confirmed === true }
}

function verdictOf(answer: PlanAnswer) {
    if (!answer.answered) return { icon: MinusIcon, labelKey: 'skipped', className: 'text-muted-foreground' } as const
    return answer.confirmed ? ({ icon: CircleCheckIcon, labelKey: 'confirmed', className: 'text-emerald-500' } as const) : ({ icon: PencilIcon, labelKey: 'askedChanges', className: 'text-muted-foreground' } as const)
}

function useCarouselEdges(cards: number) {
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
    const [edges, setEdges] = useState({ start: true, end: true })

    useEffect(() => {
        if (!scroller) return
        const update = () => {
            const start = scroller.scrollLeft <= 1
            const end = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
            setEdges(previous => (previous.start === start && previous.end === end ? previous : { start, end }))
        }
        update()
        scroller.addEventListener('scroll', update, { passive: true })
        const observer = new ResizeObserver(update)
        observer.observe(scroller)
        Array.from(scroller.children).forEach(child => observer.observe(child))
        return () => {
            scroller.removeEventListener('scroll', update)
            observer.disconnect()
        }
    }, [scroller, cards])

    const scrollByCard = (direction: 1 | -1) => {
        const card = scroller?.firstElementChild as HTMLElement | null
        if (card) scroller?.scrollBy({ left: direction * (card.offsetWidth + CARD_GAP), behavior: 'smooth' })
    }

    const mask = edges.start && edges.end ? undefined : `linear-gradient(to right, ${edges.start ? '#000' : 'transparent'} 0, #000 ${EDGE_FADE}px, #000 calc(100% - ${EDGE_FADE}px), ${edges.end ? '#000' : 'transparent'} 100%)`

    return { setScroller, edges, scrollByCard, mask }
}

function PlanBoxScene({ group, animated, framed }: { group: PlanGroup; animated: boolean; framed: boolean }) {
    const scene = useMemo(() => planCardScene(group, { animated }), [group, animated])
    const slots = Math.max(1, group.items.length)

    return (
        <div className={cn('pointer-events-none relative h-44 overflow-hidden bg-background/60', framed ? 'border-b border-border' : 'rounded-lg')}>
            <IsoGrid key={slots} tiles={scene.tiles} containers={scene.containers} selectedTileId={null} selectedContainerId={null} fitToContent mask={false} scrollGestures={false} className="absolute inset-0" />
        </div>
    )
}

function PlanAgent({ item }: { item: PlanItem }) {
    const t = useTranslations('foreman.plan')
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{item.name}</span>
                {item.role && <span className="text-xs text-muted-foreground">{item.role}</span>}
            </div>
            {item.when && (
                <Badge size="xs" tone="brand" glow={false} leading={<ClockIcon className="size-3" />} className="self-start">
                    {item.when}
                </Badge>
            )}
            {item.need && (
                <p className="rounded-md border-l-2 border-amber-500/70 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                    {t.rich('goesAfter', { need: item.need, label: chunks => <span className="font-medium text-foreground">{chunks}</span> })}
                </p>
            )}
            {item.gets && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{t('thisWeek')}</span>
                    <ul className="flex flex-col gap-1.5">
                        {item.gets.map((line, index) => (
                            <li key={index} className="flex items-start gap-2 text-xs">
                                <CircleCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-500" />
                                {line}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

function PlanBoxCard({ group, answered, streaming, framed }: { group: PlanGroup; answered: boolean; streaming: boolean; framed: boolean }) {
    const t = useTranslations('foreman.plan')
    const alive = !framed && !answered && group.items.length === 1

    return (
        <div className={cn('flex shrink-0 flex-col', framed ? 'w-[min(340px,85%)] snap-center overflow-hidden rounded-lg border border-border bg-card first:snap-start last:snap-end' : 'w-full')}>
            {alive ? <PlanLifeScene group={group} script={planLifeScript(group.items[0], { working: t('lifeWorking'), delivered: t('lifeDelivered') })} waiting={streaming} /> : <PlanBoxScene group={group} animated={!answered} framed={framed} />}
            <div className={cn('flex flex-1 flex-col gap-3', framed ? 'p-3' : 'pt-3')}>
                {group.items.map(item => (
                    <PlanAgent key={item.key} item={item} />
                ))}
            </div>
        </div>
    )
}

export function PlanCardWidget({ input, output, streaming = false, onAnswer }: PlanCardWidgetProps) {
    const t = useTranslations('foreman.plan')
    const { title, groups } = useMemo(() => {
        const plan = readPlan(input)
        return { ...plan, groups: plan.groups.filter(group => group.items.length > 0) }
    }, [input])
    const answered = readOutput(output)
    const verdict = answered && verdictOf(answered)
    const { setScroller, edges, scrollByCard, mask } = useCarouselEdges(groups.length)

    return (
        <div className={cn('relative mb-2 flex flex-col gap-3 py-4', verdict && 'mt-3 pt-6', PANEL_CARD)}>
            {verdict && (
                <TooltipLabeled label={t(verdict.labelKey)}>
                    <Icon icon={verdict.icon} size="sm" className={cn('absolute -top-3 right-2 z-10 bg-card shadow-lg shadow-black/40', verdict.className)} />
                </TooltipLabeled>
            )}
            <div className="flex items-start justify-between gap-3 px-4">
                <p className="min-w-0 text-sm font-medium">{title || t('defaultTitle')}</p>
                {groups.length > 1 && (
                    <div className="flex shrink-0 gap-1">
                        <Button size="icon-xs" variant="ghost" aria-label={t('previousBox')} disabled={edges.start} onClick={() => scrollByCard(-1)}>
                            <ChevronLeftIcon />
                        </Button>
                        <Button size="icon-xs" variant="ghost" aria-label={t('nextBox')} disabled={edges.end} onClick={() => scrollByCard(1)}>
                            <ChevronRightIcon />
                        </Button>
                    </div>
                )}
            </div>
            <div
                ref={setScroller}
                style={{ gap: CARD_GAP, maskImage: mask, WebkitMaskImage: mask }}
                className="flex snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none]"
            >
                {groups.map((group, index) => (
                    <PlanBoxCard key={index} group={group} answered={Boolean(answered)} streaming={streaming} framed={groups.length > 1} />
                ))}
            </div>
            {!answered && (
                <div className="flex flex-col gap-2 px-4">
                    <Button size="lg" disabled={streaming} onClick={() => onAnswer({ answered: true, confirmed: true })}>
                        {t('build')}
                    </Button>
                    <Button size="lg" variant="outline" disabled={streaming} onClick={() => onAnswer({ answered: true, confirmed: false })}>
                        {t('change')}
                    </Button>
                </div>
            )}
        </div>
    )
}
