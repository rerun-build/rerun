'use client'

import type { RemoteJob } from '@rerun/contracts'
import { formatDuration } from '@rerun/i18n/format'
import { PanelRow } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { computerJobsAction, stopComputerJobAction } from '@/app/api/_actions/remote-computers.actions'
import { Button } from '@/components/ui/button'
import { useErrorText } from '@/hooks/useErrorText'
import { SquareIcon, TerminalIcon } from '@/lib/icons'

// The jobs a computer runs or ran for the coworkers, newest first, read from the computer itself.
// Nothing shows while it is offline: its jobs live on it.
export function ComputerJobs({ computerId, online }: { computerId: string; online: boolean }) {
    const t = useTranslations('computers.detail')
    const tJob = useTranslations('chat.computerJob')
    const locale = useLocale()
    const errorText = useErrorText()
    const [jobs, setJobs] = useState<RemoteJob[]>([])
    const [stopping, setStopping] = useState<string | null>(null)

    const read = useCallback(async () => {
        const res = await computerJobsAction(computerId)
        if (res.ok) setJobs(res.jobs ?? [])
    }, [computerId])

    useEffect(() => {
        if (!online) return
        void read()
        const timer = setInterval(() => void read(), 10_000)
        return () => clearInterval(timer)
    }, [online, read])

    if (!online || jobs.length === 0) return null

    const stop = async (jobId: string) => {
        setStopping(jobId)
        const res = await stopComputerJobAction({ id: computerId }, jobId)
        setStopping(null)
        if (!res.ok) toast.error(errorText(res))
        await read()
    }

    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{t('jobs')}</h3>
            <div className="space-y-1.5">
                {jobs.slice(0, 10).map(job => {
                    const elapsed = formatDuration((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.startedAt), locale)
                    return (
                        <PanelRow
                            key={job.id}
                            leading={<TerminalIcon className="size-4 shrink-0 text-muted-foreground" />}
                            title={job.label || job.command}
                            description={<span className="font-mono">{job.command}</span>}
                            footer={[job.author, tJob(`state.${job.state}`), elapsed].filter(Boolean).join(' · ')}
                            actions={
                                job.state === 'running' && (
                                    <Button variant="outline" size="xs" disabled={stopping === job.id} onClick={() => void stop(job.id)}>
                                        <SquareIcon className="size-3" />
                                        {tJob('stop')}
                                    </Button>
                                )
                            }
                        />
                    )
                })}
            </div>
        </section>
    )
}
