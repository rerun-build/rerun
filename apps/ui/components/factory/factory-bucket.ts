import type { FactoryJob } from '@rerun/contracts'

export type Bucket = 'rejects' | number

const REJECTED: FactoryJob['state'][] = ['rejected', 'unsolvable']
const JUDGES = ['review', 'proof']
const BUILDERS = ['build', 'fix', 'senior']

export const isRejected = (job: FactoryJob) => REJECTED.includes(job.state)

export const bucketJobs = (jobs: FactoryJob[], bucket: Bucket) =>
    jobs.filter(j => (bucket === 'rejects' ? isRejected(j) : j.parent === bucket))

export type BucketRow = { station: string | null; by: string | null; builder: string | null }

export function bucketRow(job: FactoryJob, names: Record<string, string>): BucketRow {
    const runs = [...(job.runs ?? [])].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    const word = (stage: string) => stage.split(' ')[0]
    const who = (stages: string[]) => runs.findLast(r => stages.includes(word(r.stage)))
    const judge = isRejected(job) ? who(JUDGES) : undefined
    const builder = who(BUILDERS)
    const name = (id: string) => names[id] ?? id
    return { station: judge ? word(judge.stage) : null, by: judge ? name(judge.coworkerId) : null, builder: builder ? name(builder.coworkerId) : null }
}
