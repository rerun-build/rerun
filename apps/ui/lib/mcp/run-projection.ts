import type { RunGoalRecord } from '@rerun/contracts'

export function projectRun(run: { id: string; status: string; sessionId: string; provider: string | null; model: string | null; triggerSource: string | null; triggerSlug: string | null; stepCount: number; inputTokens: number | null; cachedInputTokens?: number | null; outputTokens: number | null; totalTokens: number | null; costMicros: number | null; startedAt: string; finishedAt: string | null; error: string | null; goal?: RunGoalRecord | null; compactions?: number | null; compactSummaryChars?: number | null; compactAtTokens?: number | null }) {
    return {
        runId: run.id,
        status: run.status,
        sessionId: run.sessionId,
        provider: run.provider,
        model: run.model,
        trigger: run.triggerSlug ? `${run.triggerSource ?? 'unknown'}:${run.triggerSlug}` : run.triggerSource,
        steps: run.stepCount,
        inputTokens: run.inputTokens,
        cachedInputTokens: run.cachedInputTokens ?? null,
        outputTokens: run.outputTokens,
        totalTokens: run.totalTokens,
        costUsd: run.costMicros === null ? null : run.costMicros / 1_000_000,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
        goal: run.goal ?? null,
        compactions: run.compactions ?? null,
        compactSummaryChars: run.compactSummaryChars ?? null,
        compactAtTokens: run.compactAtTokens ?? null,
    }
}
