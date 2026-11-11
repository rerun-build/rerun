import type { MessageAuthor, Provider } from '@rerun/contracts'
import type { UIMessageStreamWriter } from 'ai'
import type { TurnOrder } from '../agents/turn-order.js'
import type { LoadedAgent } from '../agents/types.js'
import type { AgentRow } from '../db/schema.js'
import type { Logger } from '../lib/logger.js'
import type { HostBreaker } from '../tools/host-breaker.js'
import type { ScreenshotStore } from './screenshots.js'

export type RunTrigger = { source: 'chat'; author?: MessageAuthor; userLanguage?: string; callableAgentIds?: string[]; calledBy?: string } | { source: 'schedule'; slug: string; name: string } | { source: 'trigger'; slug: string; name: string }

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
    // The user's turn goes to the database without holding the run up: a tool that reads the
    // session history back waits on it first.
    userTurnStored?: Promise<unknown>
}
