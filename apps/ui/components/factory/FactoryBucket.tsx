'use client'

import { ExternalLink } from 'lucide-react'
import type { FactoryJob } from '@rerun/contracts'
import { formatEndedAt } from './FactoryTasks'
import { bucketJobs, bucketRow, isRejected, type Bucket } from './factory-bucket'
import { JOB_STATE_VIEW } from './factory-state'

const EMPTY = 'No job in this bucket'
const NO_REASON = 'No reason recorded'

function Row({ job, repo, names, now, onSelect }: { job: FactoryJob; repo: string; names: Record<string, string>; now: number; onSelect: (issue: number) => void }) {
    const view = JOB_STATE_VIEW[job.state]
    const Icon = view.icon
    const { station, by, builder } = bucketRow(job, names)
    const rejected = isRejected(job)
    const word = job.state.replace('_', ' ')
    const ended = rejected ? (station ? `${word} at ${station} by ${by}` : `${word}, station not recorded`) : word
    const built = builder ? `built by ${builder}` : rejected ? 'builder not recorded' : null
    const base = `https://github.com/${repo}`
    const linkCls = 'flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
    return (
        <li data-bucket-row={job.issue} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted">
            <button type="button" data-bucket-open={job.issue} onClick={() => onSelect(job.issue)} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                <span className="flex items-center gap-2 text-sm">
                    <Icon className="size-3.5 shrink-0" style={{ color: view.color }} aria-hidden />
                    <span className="truncate">#{job.issue} {job.title}</span>
                </span>
                <span className="pl-5 text-xs text-muted-foreground">
                    {ended}{built ? ` · ${built}` : ''} · <time dateTime={job.enteredAt}>{formatEndedAt(job.enteredAt, now)}</time>
                </span>
                {(job.reason !== null || rejected) && <span className="pl-5 text-xs">{job.reason ?? NO_REASON}</span>}
            </button>
            <a href={`${base}/issues/${job.issue}`} target="_blank" rel="noreferrer" aria-label={`Issue ${job.issue}`} className={linkCls}>issue<ExternalLink className="size-3" /></a>
            {job.pr !== null && <a href={`${base}/pull/${job.pr}`} target="_blank" rel="noreferrer" aria-label={`PR ${job.pr}`} className={linkCls}>PR {job.pr}<ExternalLink className="size-3" /></a>}
        </li>
    )
}

export function FactoryBucket({ bucket, jobs, repo, names, now, onSelect }: {
    bucket: Bucket; jobs: FactoryJob[]; repo: string; names: Record<string, string>; now: number; onSelect: (issue: number) => void
}) {
    const mine = bucketJobs(jobs, bucket)
    const count = (state: FactoryJob['state']) => mine.filter(j => j.state === state).length
    const title = bucket === 'rejects'
        ? `Rejected jobs: ${mine.length}`
        : `Feature #${bucket}: ${count('merged')} merged, ${mine.filter(isRejected).length} rejected, ${mine.length} tasks`
    return (
        <section data-bucket={bucket} className="flex flex-col gap-2">
            <h3 data-bucket-title className="text-sm font-medium">{title}</h3>
            {mine.length === 0
                ? <p className="text-xs text-muted-foreground">{EMPTY}</p>
                : <ul className="flex flex-col">{mine.map(j => <Row key={j.issue} job={j} repo={repo} names={names} now={now} onSelect={onSelect} />)}</ul>}
        </section>
    )
}
