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

type PlanUsageReader = (options: { skipBehaviors: boolean }) => Promise<ClaudePlanUsage>

// The SDK ships the plan usage read under a name that announces it will be renamed. Looked up by
// key rather than called as a method, so the CLI bump that moves it costs a gauge and not a run.
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

export type ClaudeCompaction = { status: 'running' } | { status: 'done'; tokensRecovered?: number }

// The context window occupancy only exists while the CLI subprocess is alive:
// `getContextUsage()` is a control-protocol round-trip that rejects once the
// query has finished, so it must run inside a Stop hook. The hook's return
// blocks the CLI's end of turn, hence the hard timeout. The plan limits of the
// subscription are read on the same occasion, for the same reason.
export function claudeContextCapture(connectionId?: string, onCompaction?: (compaction: ClaudeCompaction) => void): ClaudeContextCapture {
    let query: Query | undefined
    let snapshot: ContextOccupancy | undefined

    const captureOccupancy = async (live: Query): Promise<void> => {
        const usage = await withinTimeout(live.getContextUsage())
        if (typeof usage?.totalTokens === 'number' && typeof usage.maxTokens === 'number' && usage.maxTokens > 0) {
            snapshot = { usedTokens: usage.totalTokens, maxTokens: usage.maxTokens }
        }
    }

    const capturePlanLimits = async (live: Query): Promise<void> => {
        const readPlanUsage = connectionId ? planUsageReaderOf(live) : undefined
        if (!connectionId || !readPlanUsage) return
        // Wrapped in a function so a reader that throws synchronously lands in the same catch.
        const usage = await withinTimeout((async () => readPlanUsage({ skipBehaviors: true }))())
        recordPlanLimits(connectionId, planLimitWindowsFromClaude(usage))
    }

    // Read off the initialization the run waits for anyway, never awaited by it. The binary is the one
    // the Agent SDK ships with this release, so it is never off its pin: what it leaves out is the
    // account's doing.
    const captureCliModels = async (live: Query): Promise<void> => {
        if (!connectionId || cliModelsFresh(connectionId, CLI_MODELS_MAX_AGE_MS)) return
        try {
            const init = await live.initializationResult()
            const models = init.models.flatMap(model => [model.value, model.resolvedModel].filter((id): id is string => typeof id === 'string'))
            recordCliModels(connectionId, models, init.claude_code_version ?? null, false)
        } catch {
            // A query that ended first: the next run reads it.
        }
    }

    const stopHook = async (): Promise<{ continue: boolean }> => {
        if (query) await Promise.all([captureOccupancy(query), capturePlanLimits(query)])
        return { continue: true }
    }

    const usedTokens = async (): Promise<number | undefined> => (query ? (await withinTimeout(query.getContextUsage()))?.totalTokens : undefined)

    let tokensBeforeCompaction: number | undefined
    const preCompactHook = async (): Promise<{ continue: boolean }> => {
        tokensBeforeCompaction = await usedTokens()
        onCompaction?.({ status: 'running' })
        return { continue: true }
    }
    const postCompactHook = async (): Promise<{ continue: boolean }> => {
        const after = await usedTokens()
        const before = tokensBeforeCompaction
        tokensBeforeCompaction = undefined
        onCompaction?.(typeof before === 'number' && typeof after === 'number' ? { status: 'done', tokensRecovered: Math.max(0, before - after) } : { status: 'done' })
        return { continue: true }
    }

    return {
        read: () => snapshot,
        settings: {
            onQueryCreated: q => {
                query = q
                void captureCliModels(q)
            },
            hooks: {
                Stop: [{ hooks: [stopHook] }],
                // The provider drops the CLI's compaction boundary, so its hooks are the only way to see it.
                ...(onCompaction ? { PreCompact: [{ hooks: [preCompactHook] }], PostCompact: [{ hooks: [postCompactHook] }] } : {}),
            },
        },
    }
}
