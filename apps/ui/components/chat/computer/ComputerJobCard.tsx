'use client'

import type { RemoteJob, RemoteJobState } from '@rerun/contracts'
import { formatDuration } from '@rerun/i18n/format'
import { BorderBeam } from '@rerun/ui'
import { Badge, Icon, type BadgeTone } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { computerJobAction, stopComputerJobAction } from '@/app/api/_actions/remote-computers.actions'
import { ComputerHandle } from '@/components/computers/ComputerBits'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorText } from '@/hooks/useErrorText'
import { SquareIcon, TerminalIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const POLL_MS = 5_000

type CardState = RemoteJobState | 'offline' | 'gone'

const BADGE: Record<CardState, { tone: BadgeTone; animated?: boolean }> = {
    running: { tone: 'brand', animated: true },
    succeeded: { tone: 'green' },
    failed: { tone: 'red' },
    stopped: { tone: 'neutral' },
    lost: { tone: 'orange' },
    offline: { tone: 'neutral' },
    gone: { tone: 'neutral' },
}

// `gone`: the job cannot be read any more (the computer was removed, or no longer knows it).
type JobView = { job: RemoteJob | null; output: string; offline: boolean; gone?: boolean }

// A job a coworker started on a computer, in the chat where it started it: what it is doing now, the
// last lines it printed, and Stop. Read again every few seconds while it runs; its end wakes the
// coworker, which then says what came out of it.
export function ComputerJobCard({ computer, jobId, command, label }: { computer: string; jobId: string; command: string; label?: string }) {
    const t = useTranslations('chat.computerJob')
    const locale = useLocale()
    const errorText = useErrorText()
    const [view, setView] = useState<JobView | null>(null)
    const [stopping, setStopping] = useState(false)

    const read = useCallback(async () => {
        const res = await computerJobAction(computer, jobId)
        // A read that failed is tried again at the next tick: the job is still running over there.
        if (!res.ok) return
        if (res.gone) return setView(current => ({ job: current?.job ?? null, output: current?.output ?? '', offline: false, gone: true }))
        setView(res.logs ? { job: res.logs.job, output: res.logs.output, offline: false } : current => ({ job: current?.job ?? null, output: current?.output ?? '', offline: true }))
    }, [computer, jobId])

    const running = !view?.gone && (!view?.job || view.job.state === 'running')
    useEffect(() => {
        void read()
        if (!running) return
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void read()
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [read, running])

    const stop = async () => {
        setStopping(true)
        const res = await stopComputerJobAction({ handle: computer }, jobId)
        setStopping(false)
        if (!res.ok) return toast.error(errorText(res))
        await read()
    }

    const state: CardState = view?.gone ? 'gone' : view?.offline ? 'offline' : (view?.job?.state ?? 'running')
    const job = view?.job
    const elapsed = job ? formatDuration((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.startedAt), locale) : null
    const lines = (view?.output ?? '').trimEnd().split('\n').slice(-4).join('\n')

    return (
        <div className="relative space-y-2.5 overflow-hidden rounded-lg border bg-muted/20 px-3 py-3" data-job={jobId}>
            {view && state === 'running' && <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={5} />}
            <div className="flex items-center gap-2.5">
                <Icon size="sm" icon={TerminalIcon} />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{label || command}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        <ComputerHandle handle={computer} />
                        {elapsed && <span className="tabular-nums"> · {elapsed}</span>}
                    </p>
                </div>
                {/* Not read yet: a card mounted again after its job ended must not claim it still runs. */}
                {view ? (
                    <Badge size="xs" tone={BADGE[state].tone} animated={BADGE[state].animated} glow={false}>
                        {t(`state.${state}`)}
                    </Badge>
                ) : (
                    <Skeleton className="h-4 w-14 rounded-full" />
                )}
            </div>
            {lines && <pre className={cn('max-h-28 overflow-hidden rounded bg-background px-2 py-1.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap', state === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{lines}</pre>}
            {state === 'offline' && <p className="text-xs text-muted-foreground">{t('offlineNote')}</p>}
            {state === 'lost' && <p className="text-xs text-muted-foreground">{t('lostNote')}</p>}
            {state === 'gone' && <p className="text-xs text-muted-foreground">{t('goneNote')}</p>}
            {state === 'running' && view && (
                <div className="flex justify-end">
                    <Button size="xs" variant="outline" disabled={stopping} onClick={() => void stop()}>
                        <SquareIcon className="size-3" />
                        {t('stop')}
                    </Button>
                </div>
            )}
        </div>
    )
}
