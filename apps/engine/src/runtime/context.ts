import type { MessageAuthor, Provider, RunGoal } from '@rerun/contracts'
import type { UIMessageStreamWriter } from 'ai'
import type { TurnOrder } from '../agents/turn-order.js'
import type { LoadedAgent } from '../agents/types.js'
import type { AgentRow } from '../db/schema.js'
import type { Logger } from '../lib/logger.js'
import type { HostBreaker } from '../tools/host-breaker.js'
import type { ScreenshotStore } from './screenshots.js'

export type RunLineage = { initiatorAgentId?: string; initiatorRunId?: string; initiatorSessionId?: string; initiatorUserId?: string; jobRef?: string; branch?: string }

export type RunTrigger = { source: 'chat'; author?: MessageAuthor; userLanguage?: string; callableAgentIds?: string[]; calledBy?: string; lineage?: RunLineage; goal?: RunGoal } | { source: 'schedule'; slug: string; name: string } | { source: 'trigger'; slug: string; name: string }

export type PartialResult = { label: string; text: string }

export type DelegatedUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number; totalTokens: number }

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
    lineage?: RunLineage
    writer?: UIMessageStreamWriter
    abortSignal?: AbortSignal
    callTargets?: AgentRow[]
    callableAgentIds?: string[]
    hostBreaker?: HostBreaker
    partialResults?: PartialResult[]
    delegated?: DelegatedUsage
    skillProposals?: SkillProposalNotice[]
    screenshots?: ScreenshotStore
    userTurnStored?: Promise<unknown>
}
