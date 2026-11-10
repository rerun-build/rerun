'use client'

import { TextShimmer } from '@rerun/ui'
import { Badge, ScrollFade } from '@rerun/ui/primitives'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import { StepGlyph } from '@/components/chat/StepRow'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatElapsed } from '@/hooks/useElapsed'
import type { ToolDisplay } from '@/hooks/useToolDisplay'
import { stripBridgePrefix } from '@/lib/chat/bridge-name'
import { isSubRunFailing, isSubRunLive, isSubRunStalled, subRunOutcome, type SubRunCall, type SubRunTask } from '@/lib/chat/sub-run-progress'
import { CheckIcon, ChevronRightIcon, ClockIcon, SquareIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ToolDisplayOf = (toolName: string) => ToolDisplay

type Tone = 'brand' | 'green' | 'red' | 'muted'

const BRANCH_TONE: Record<Tone, string> = {
    brand: 'border-brand/70',
    green: 'border-emerald-400/70',
    red: 'border-red-400/70',
    muted: 'border-border',
}

const VISIBLE_LIVE_CALLS = 3

const STEP_VERB_KEYS: Record<string, 'search' | 'read' | 'browse' | 'run' | 'write' | 'edit'> = {
    web_search: 'search',
    web_fetch: 'read',
    browser_navigate: 'browse',
    shell_exec: 'run',
    fs_read: 'read',
    fs_write: 'write',
    fs_edit: 'edit',
}

const EASE = [0.4, 0, 0.2, 1] as const

function toneOf(task: SubRunTask): Tone {
    if (task.status === 'running') return isSubRunFailing(task) ? 'red' : 'brand'
    if (task.status === 'done' || task.status === 'dispatched') return 'green'
    if (task.status === 'error') return 'red'
    return 'muted'
}

const settledSeconds = (task: SubRunTask) => (task.startedAt === undefined || task.finishedAt === undefined ? undefined : Math.max(0, (task.finishedAt - task.startedAt) / 1000))

type SubRunTreeProps = {
    tasks: SubRunTask[]
    toolDisplay: ToolDisplayOf
    onStopTask?: (taskId: string) => void
}

/** A delegation's tasks hanging from one trunk: the last calls of each while it works, its result once it settles. */
export function SubRunTree({ tasks, toolDisplay, onStopTask }: SubRunTreeProps) {
    return (
        <div className="@container flex flex-col gap-1 px-1 pt-1 pb-1">
            {tasks.map((task, i) => (
                <TaskBranch key={task.id ?? i} task={task} last={i === tasks.length - 1} toolDisplay={toolDisplay} onStop={onStopTask} />
            ))}
        </div>
    )
}

function Branch({ tone, last, children, className }: { tone: Tone; last: boolean; children: ReactNode; className?: string }) {
    return (
        <div className={cn('relative pl-6', className)}>
            {!last && <span aria-hidden className={cn('absolute top-0 -bottom-1 left-2.5 border-l transition-colors duration-500', BRANCH_TONE[tone])} />}
            <span aria-hidden className={cn('absolute top-0 left-2.5 h-3.5 w-3 rounded-bl-md border-b border-l transition-colors duration-500', BRANCH_TONE[tone])} />
            {children}
        </div>
    )
}

function TaskStatus({ task }: { task: SubRunTask }) {
    if (task.status === 'running') return <IconBadge tone={isSubRunFailing(task) ? 'red' : 'brand'} animated glow={false} />
    if (task.status === 'error') return <IconBadge tone="red" icon={XIcon} glow={false} />
    if (task.status === 'stopped') return <IconBadge tone="neutral" icon={SquareIcon} glow={false} />
    if (task.status === 'queued') return <IconBadge tone="neutral" icon={ClockIcon} glow={false} />
    return <IconBadge tone="green" icon={CheckIcon} glow={false} />
}

function TaskBranch({ task, last, toolDisplay, onStop }: { task: SubRunTask; last: boolean; toolDisplay: ToolDisplayOf; onStop?: (taskId: string) => void }) {
    const t = useTranslations('chat.subRun')
    const [open, setOpen] = useState(false)
    const [stopRequested, setStopRequested] = useState(false)
    const tone = toneOf(task)
    const running = task.status === 'running'
    const settled = !isSubRunLive(task)
    const expandable = settled && (!!task.calls?.length || !!task.preview)
    const seconds = settled ? settledSeconds(task) : undefined
    const idleMinutes = Math.floor((task.idleMs ?? 0) / 60_000)
    const canStop = !!onStop && !!task.id && running

    return (
        <Branch tone={tone} last={last}>
            <Collapsible open={open && expandable} onOpenChange={setOpen}>
                <div className="flex items-center gap-1">
                    <CollapsibleTrigger
                        disabled={!expandable}
                        className="group flex h-7 min-w-0 flex-1 items-center gap-2.5 rounded-md pr-1 text-left text-sm transition-colors enabled:hover:bg-muted/50"
                    >
                        <TaskStatus task={task} />
                        <span className={cn('min-w-0 flex-1 truncate font-medium', task.status === 'queued' && 'text-muted-foreground')}>{task.title}</span>
                        {isSubRunFailing(task) && (
                            <Badge tone="red" size="xs" glow={false} className="hidden @md:inline-flex">
                                {t('failuresInARow', { count: task.failures ?? 0 })}
                            </Badge>
                        )}
                        {isSubRunStalled(task) && (
                            <Badge tone="orange" size="xs" glow={false} className="hidden @md:inline-flex">
                                {t('idle', { minutes: idleMinutes })}
                            </Badge>
                        )}
                        {seconds !== undefined && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatElapsed(seconds)}</span>}
                        <ChevronRightIcon className={cn('size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90', !expandable && 'invisible')} />
                    </CollapsibleTrigger>
                    {canStop && (
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t('stopTask')}
                            disabled={stopRequested}
                            className="-my-1 size-7 shrink-0 text-muted-foreground"
                            onClick={event => {
                                event.stopPropagation()
                                setStopRequested(true)
                                onStop!(task.id!)
                            }}
                        >
                            <SquareIcon className="size-3" />
                        </Button>
                    )}
                </div>

                {running && <LiveSteps task={task} tone={tone} toolDisplay={toolDisplay} />}
                {settled && !open && <Outcome task={task} />}

                {expandable && (
                    <CollapsibleContent>
                        <div className="flex flex-col gap-1.5 pt-1 pb-1">
                            {!!task.calls?.length && (
                                <div className="flex flex-col">
                                    {task.calls.map((call, i) => (
                                        <StepLine key={i} call={call} tone={tone} last={i === task.calls!.length - 1} toolDisplay={toolDisplay} />
                                    ))}
                                </div>
                            )}
                            <Outcome task={task} />
                            {task.preview && (
                                <div className="ml-6 rounded-md bg-muted/40">
                                    <ScrollFade className="max-h-40" fadeSize={32}>
                                        <p className="px-2.5 py-2 text-xs whitespace-pre-wrap break-words text-foreground/80">{task.preview}</p>
                                    </ScrollFade>
                                </div>
                            )}
                        </div>
                    </CollapsibleContent>
                )}
            </Collapsible>
        </Branch>
    )
}

function Outcome({ task }: { task: SubRunTask }) {
    const t = useTranslations('chat.subRun')
    if (task.status === 'done') {
        const result = subRunOutcome(task.preview)
        if (!result) return null
        return (
            <p className="flex h-6 items-center gap-2.5 pl-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckIcon className="size-3.5 shrink-0" />
                <span className="truncate">{result}</span>
            </p>
        )
    }
    if (task.status === 'error' || task.status === 'stopped') {
        return (
            <p className={cn('flex h-6 items-center gap-2.5 pl-0.5 text-xs', task.status === 'error' ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground')}>
                {task.status === 'error' ? <XIcon className="size-3.5 shrink-0" /> : <SquareIcon className="size-3 shrink-0" />}
                <span className="truncate">{task.status === 'stopped' ? t('stopped') : task.error || t('failed')}</span>
            </p>
        )
    }
    return null
}

function LiveSteps({ task, tone, toolDisplay }: { task: SubRunTask; tone: Tone; toolDisplay: ToolDisplayOf }) {
    const t = useTranslations('chat.subRun')
    const calls: SubRunCall[] = task.calls?.length ? task.calls : task.activity ? [{ tool: task.activity, summary: '', elapsedMs: task.idleMs ?? 0 }] : []
    // The engine only keeps the last calls of a task, its count still has them all.
    const total = task.calls?.length ? Math.max(task.toolCalls ?? 0, calls.length) : calls.length
    const visible = calls.slice(-VISIBLE_LIVE_CALLS)
    const hidden = total - visible.length
    const inFlight = calls.some(call => call.elapsedMs !== undefined)

    return (
        <div className="flex flex-col">
            {hidden > 0 && <div className="flex h-6 items-center pl-6 text-[11px] text-muted-foreground/70">{t('earlier', { count: hidden })}</div>}
            <AnimatePresence initial={false}>
                {visible.map((call, i) => (
                    <motion.div
                        key={total - visible.length + i}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                    >
                        <StepLine call={call} tone={tone} last={inFlight && i === visible.length - 1} toolDisplay={toolDisplay} />
                    </motion.div>
                ))}
            </AnimatePresence>
            {!inFlight && (
                <Branch tone={tone} last className="opacity-60">
                    <div className="flex h-6 items-center gap-2.5">
                        <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
                        <Skeleton className="h-2 w-32 max-w-[60%] rounded-full" />
                    </div>
                </Branch>
            )}
        </div>
    )
}

function StepLine({ call, tone, last, toolDisplay }: { call: SubRunCall; tone: Tone; last: boolean; toolDisplay: ToolDisplayOf }) {
    const t = useTranslations('chat.subRun')
    const tool = stripBridgePrefix(call.tool)
    const display = toolDisplay(tool)
    const current = call.elapsedMs !== undefined
    const verbKey = STEP_VERB_KEYS[tool]
    const label = (verbKey ? t(`verbs.${verbKey}`, { summary: call.summary }) : `${display.label} ${call.summary}`).trim()
    return (
        <Branch tone={call.failed ? 'red' : tone} last={last}>
            <div className={cn('flex h-6 min-w-0 items-center gap-2.5 text-xs', call.failed ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground')}>
                {call.failed ? <XIcon className="size-3.5 shrink-0" /> : <StepGlyph iconProps={display.iconProps} />}
                <span className="min-w-0 flex-1 truncate">{current ? <TextShimmer className="block truncate text-xs">{label}</TextShimmer> : label}</span>
                {call.failed && <span className="shrink-0">{t('failed')}</span>}
            </div>
        </Branch>
    )
}
