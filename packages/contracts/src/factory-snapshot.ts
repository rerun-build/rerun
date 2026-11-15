import { z } from 'zod'

export const factoryJobStateSchema = z.enum([
    'waiting', 'queued', 'building', 'review_wait', 'reviewing', 'fix_wait', 'fixing', 'checks',
    'merged', 'rejected', 'blocked', 'failed', 'returned',
])

export const factoryWorkerTypeSchema = z.enum(['coder', 'reviewer', 'researcher', 'designer'])

export const factoryDepartmentSchema = z.enum(['design', 'database', 'engine', 'backend', 'frontend', 'tooling', 'docs'])

export const factoryEpicKindSchema = z.enum(['feature', 'review_fix', 'fix', 'upgrade', 'refactor', 'research', 'other'])

const isoTime = z.string().max(40).datetime({ offset: true })
const count = z.number().int().min(0)

const factoryHistoryEntrySchema = z.object({
    state: factoryJobStateSchema,
    at: isoTime,
    reason: z.string().max(300).nullable(),
    runId: z.string().max(64).nullable(),
}).strict()

const factoryRunSchema = z.object({
    stage: z.string().max(20),
    coworkerId: z.string().max(64),
    status: z.string().max(20),
    startedAt: isoTime,
    endedAt: isoTime.nullable(),
    tokensIn: count,
    tokensOut: count,
    runId: z.string().max(64).nullable(),
}).strict()

export const factoryJobSchema = z.object({
    issue: z.number().int().positive(),
    title: z.string().max(256), // GitHub's own limit for an issue title
    state: factoryJobStateSchema,
    enteredAt: isoTime, // when the job entered its state
    pr: z.number().int().positive().nullable(),
    round: z.number().int().min(1).max(9).nullable(), // the review round
    coworker: z.string().max(64).nullable(), // who holds it now
    copy: z.number().int().min(1).max(32).nullable(), // which run of that coworker
    steps: count.nullable(), // steps of the current run
    tokensIn: count.nullable(),
    tokensOut: count.nullable(),
    parent: z.number().int().positive().nullable(), // the feature it was cut from, when the cut names one
    dependsOn: z.array(z.number().int().positive()).max(20),
    closedOutside: z.literal(true).optional(), // its issue was closed by hand with no merged pull request
    reason: z.string().max(300).nullable(), // why it waits, or why it ended blocked, failed or returned
    history: z.array(factoryHistoryEntrySchema).max(30).optional(), // oldest first
    runs: z.array(factoryRunSchema).max(12).optional(),
    department: factoryDepartmentSchema.optional(), // the main department
    departments: z.array(factoryDepartmentSchema).max(6).optional(), // the other ones touched
}).strict()

export const factoryEpicSchema = z.object({
    issue: z.number().int().positive(),
    title: z.string().max(256), // as the job title
    kind: factoryEpicKindSchema,
}).strict()

export const factoryHoldSchema = z.object({ kind: z.string().max(40), until: isoTime }).strict()

export const factoryPoolSchema = z.object({
    type: factoryWorkerTypeSchema,
    coworkers: z.array(z.object({ name: z.string().max(64), id: z.string().max(64).optional(), runs: z.number().int().min(1).max(32), out: z.number().int().min(0).max(32) }).strict()).max(20),
}).strict()

export const factorySnapshotSchema = z.object({
    version: z.literal(1),
    madeAt: isoTime,
    beat: count,
    repo: z.string().max(200),
    jobs: z.array(factoryJobSchema).max(300),
    epics: z.array(factoryEpicSchema).max(50).optional(),
    holds: z.array(factoryHoldSchema).max(10),
    pools: z.array(factoryPoolSchema).max(8),
    endedToday: z.object({ merged: count, rejected: count, blocked: count, failed: count, returned: count }).strict(),
}).strict()

export const FACTORY_SNAPSHOT_MAX_BYTES = 256 * 1024

export type FactoryJobState = z.infer<typeof factoryJobStateSchema>
export type FactoryWorkerType = z.infer<typeof factoryWorkerTypeSchema>
export type FactoryDepartment = z.infer<typeof factoryDepartmentSchema>
export type FactoryEpicKind = z.infer<typeof factoryEpicKindSchema>
export type FactoryEpic = z.infer<typeof factoryEpicSchema>
export type FactoryJob = z.infer<typeof factoryJobSchema>
export type FactoryHold = z.infer<typeof factoryHoldSchema>
export type FactoryPool = z.infer<typeof factoryPoolSchema>
export type FactorySnapshot = z.infer<typeof factorySnapshotSchema>
