import type { CheckinReason, MessageAuthor, Provider } from '@rerun/contracts'
import type { UIMessageStreamWriter } from 'ai'
import type { TurnOrder } from '../agents/turn-order.js'
import type { LoadedAgent } from '../agents/types.js'
import type { AgentRow } from '../db/schema.js'
import type { Logger } from '../lib/logger.js'
import type { HostBreaker } from '../tools/host-breaker.js'
import type { ScreenshotStore } from './screenshots.js'

// `checkin`: the Chief of Staff woke on its own (checkins/run.ts). Its session keeps the `schedule`
// source, which the published apps know; only the run's `trigger_source` says `checkin`. `slug` and
// `name` are those of the routine that asked for it, or the check-in's own.
export type RunTrigger =
    | { source: 'chat'; author?: MessageAuthor; userLanguage?: string; callableAgentIds?: string[]; calledBy?: string }
    | { source: 'schedule'; slug: string; name: string }
    | { source: 'trigger'; slug: string; name: string }
    | { source: 'job'; computer: string; jobId: string }
    | { source: 'checkin'; slug: string; name: string; reason: CheckinReason }

// No one is in the chat: a schedule, a trigger, a check-in, the end of a job on a linked computer, or
// another coworker started the run.
export const runsUnattended = (trigger: RunTrigger): boolean => trigger.source === 'schedule' || trigger.source === 'trigger' || trigger.source === 'checkin' || trigger.source === 'job' || (trigger.source === 'chat' && trigger.calledBy !== undefined)

// A check-in only reads and suggests: its tools, its CLI sandbox and its end all follow from this.
export const runsReadOnly = (trigger: RunTrigger): boolean => trigger.source === 'checkin'

export type PartialResult = { label: string; text: string }

export type SkillProposalNotice = { proposalId: string; mode: string; title: string }

export type RunContext = {
    agent: LoadedAgent
    sessionId: string
    runId?: string
    logger: Logger
    provider: Provider
    model: string
    turnOrder: TurnOrder
    author?: MessageAuthor
    writer?: UIMessageStreamWriter
    abortSignal?: AbortSignal
    callTargets?: AgentRow[]
    // Who the person behind the run reaches, handed down to every coworker it calls.
    callableAgentIds?: string[]
    hostBreaker?: HostBreaker
    partialResults?: PartialResult[]
    skillProposals?: SkillProposalNotice[]
    screenshots?: ScreenshotStore
    // What the run's compaction summaries cost, added to the cost of its steps when it settles.
    compactionCostMicros?: number
    // The user's turn goes to the database without holding the run up: a tool that reads the
    // session history back waits on it first.
    userTurnStored?: Promise<unknown>
    // See `runsUnattended`.
    unattended?: boolean
    // See `runsReadOnly`.
    readOnly?: boolean
}
