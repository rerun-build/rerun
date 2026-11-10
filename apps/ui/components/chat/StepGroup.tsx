'use client'

import { TextShimmer } from '@rerun/ui'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { ScrollFade } from '@rerun/ui/primitives'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import type { ToolIconProps } from '@/hooks/useToolDisplay'
import { ChevronRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { StepGlyph, type StepStatus } from './StepRow'

export type StepGroupItem = { key: string; iconProps: ToolIconProps; node: ReactNode; status: StepStatus; runningLabel?: string }

const MAX_STACKED = 4
const EASE = [0.4, 0, 0.2, 1] as const

// Distinct tools in order of first use, so a new one lands at the end of the stack instead of reshuffling it.
function usedTools(items: StepGroupItem[]): ToolIconProps[] {
    const seen = new Map<unknown, ToolIconProps>()
    for (const item of items) {
        const identity = item.iconProps.src ?? item.iconProps.icon
        if (!seen.has(identity)) seen.set(identity, item.iconProps)
    }
    return [...seen.values()]
}

function ToolStack({ items }: { items: StepGroupItem[] }) {
    const tools = usedTools(items)
    const shown = tools.slice(-MAX_STACKED)
    const hidden = tools.length - shown.length
    return (
        <span className="flex shrink-0 items-center">
            <AnimatePresence initial={false} mode="popLayout">
                {shown.map((iconProps, i) => (
                    <motion.span
                        key={hidden + i}
                        layout
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        className={cn('flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background', i > 0 && '-ml-1')}
                    >
                        <StepGlyph iconProps={iconProps} className="size-3" />
                    </motion.span>
                ))}
            </AnimatePresence>
            {hidden > 0 && <span className="ml-1 font-mono text-[11px] tabular-nums text-muted-foreground">+{hidden}</span>}
        </span>
    )
}

function Activity({ label }: { label: string }) {
    return (
        <span className="relative flex min-w-0 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25, ease: EASE }} className="min-w-0 truncate">
                    <TextShimmer className="block truncate text-sm">{label}</TextShimmer>
                </motion.span>
            </AnimatePresence>
        </span>
    )
}

/**
 * The run of steps between two pieces of text: the coworker and what it is doing while it works,
 * beside a pill with every tool used so far. The pill opens on the full list of steps.
 */
export function StepGroup({ items, agentId }: { items: StepGroupItem[]; agentId?: string }) {
    const t = useTranslations('chat.steps')
    const [open, setOpen] = useState(false)
    const running = items.find(item => item.status === 'running')
    const live = !!running
    const failed = items.filter(item => item.status === 'error').length
    const count = t('count', { count: items.length })

    return (
        <div className="flex w-full flex-col">
            <div className="flex h-8 min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {agentId && <AgentBuddy agentId={agentId} mood={live ? 'working' : 'idle'} size={24} facing="right" animated={live} />}
                {running?.runningLabel && <Activity label={running.runningLabel} />}
                <button
                    type="button"
                    aria-expanded={open}
                    aria-label={failed > 0 ? t('countWithFailures', { count: items.length, failed }) : count}
                    onClick={() => setOpen(!open)}
                    className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 pr-2 pl-1 transition-colors hover:bg-muted/70"
                >
                    <ToolStack items={items} />
                    <span className="tabular-nums">{live ? items.length : count}</span>
                    {failed > 0 && <span className="text-red-500">{t('failed', { failed })}</span>}
                    <ChevronRightIcon className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
                </button>
            </div>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
                        <ScrollFade className="mt-1 max-h-[240px]" fadeSize={32} pinBottom={live}>
                            {items.map(item => (
                                <div key={item.key}>{item.node}</div>
                            ))}
                        </ScrollFade>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
