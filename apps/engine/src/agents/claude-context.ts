import type { ContextOccupancy } from '@rerun/contracts'
import type { ClaudeCodeSettings, Query } from 'ai-sdk-provider-claude-code'
import { cliModelsFresh, recordCliModels } from '../connections/cli-models.js'
import { planLimitWindowsFromClaude, recordPlanLimits, type ClaudePlanUsage } from '../connections/plan-limits.js'

const CONTEXT_USAGE_TIMEOUT_MS = 3000
const CLI_MODELS_MAX_AGE_MS = 30 * 60_000

export type ClaudeContextCapture = {
    read: () => ContextOccupancy | undefined
    settings: Pick<ClaudeCodeSettings, 'hooks' | 'onQueryCreated'>
}

export type CompactListener = (event: { trigger: string; summaryChars: number; summary?: string; handoverN?: number }) => void

export type HandoverTarget = { agentName: string; runId: string }

export const handoverNote = (agentName: string, runId: string, n: number): string =>
    `Write this summary as a handover note for the next session, in exactly this format, filling every section:

HANDOVER ${agentName} ${runId} ${n}
Task: the goal in one line, and the job or issue reference
Done: what is finished, with paths and links
Left: what remains, in order
Decisions: what was decided and why, one line each
Open questions: what is still unknown
Files: paths read or written that matter for continuing`

type PlanUsageReader = (options: { skipBehaviors: boolean }) => Promise<ClaudePlanUsage>

function planUsageReaderOf(query: Query): PlanUsageReader | undefined {
    const reader = (query as unknown as Record<string, unknown>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
    return typeof reader === 'function' ? (reader as PlanUsageReader).bind(query) : undefined
}

async function withinTimeout<T>(task: Promise<T>): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            task,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('claude usage read timed out')), CONTEXT_USAGE_TIMEOUT_MS)
            }),
        ])
    } catch {
        return undefined
    } finally {
        clearTimeout(timer)
    }
}

export function claudeContextCapture(connectionId?: string, onCompact?: CompactListener, handover?: HandoverTarget): ClaudeContextCapture {
    let query: Query | undefined
    let snapshot: ContextOccupancy | undefined
    let compactions = 0

    const captureOccupancy = async (live: Query): Promise<void> => {
        const usage = await withinTimeout(live.getContextUsage())
        if (typeof usage?.totalTokens === 'number' && typeof usage.maxTokens === 'number' && usage.maxTokens > 0) {
            snapshot = { usedTokens: usage.totalTokens, maxTokens: usage.maxTokens }
        }
    }

    const capturePlanLimits = async (live: Query): Promise<void> => {
        const readPlanUsage = connectionId ? planUsageReaderOf(live) : undefined
        if (!connectionId || !readPlanUsage) return
        const usage = await withinTimeout((async () => readPlanUsage({ skipBehaviors: true }))())
        recordPlanLimits(connectionId, planLimitWindowsFromClaude(usage))
    }

    const captureCliModels = async (live: Query): Promise<void> => {
        if (!connectionId || cliModelsFresh(connectionId, CLI_MODELS_MAX_AGE_MS)) return
        try {
            const init = await live.initializationResult()
            const models = init.models.flatMap(model => [model.value, model.resolvedModel].filter((id): id is string => typeof id === 'string'))
            recordCliModels(connectionId, models, init.claude_code_version ?? null, false)
        } catch {
        }
    }

    const stopHook = async (): Promise<{ continue: boolean }> => {
        if (query) await Promise.all([captureOccupancy(query), capturePlanLimits(query)])
        return { continue: true }
    }

    const compactHook = async (...args: unknown[]): Promise<{ continue: boolean }> => {
        const input = (args[0] ?? {}) as { trigger?: string; compact_summary?: string }
        const event = { trigger: input.trigger ?? 'unknown', summaryChars: input.compact_summary?.length ?? 0 }
        onCompact?.(handover ? { ...event, summary: input.compact_summary, handoverN: compactions } : event)
        return { continue: true }
    }

    const preCompactHook = async (): Promise<{ systemMessage: string }> => {
        compactions += 1
        return { systemMessage: handoverNote(handover!.agentName, handover!.runId, compactions) }
    }

    return {
        read: () => snapshot,
        settings: {
            onQueryCreated: q => {
                query = q
                void captureCliModels(q)
            },
            hooks: { Stop: [{ hooks: [stopHook] }], PostCompact: [{ hooks: [compactHook] }], ...(handover && { PreCompact: [{ hooks: [preCompactHook] }] }) },
        },
    }
}
