export function projectRun(run: { id: string; status: string; sessionId: string; provider: string | null; model: string | null; triggerSource: string | null; triggerSlug: string | null; stepCount: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; costMicros: number | null; startedAt: string; finishedAt: string | null; error: string | null; exitCode?: number | null }) {
    return {
        runId: run.id,
        status: run.status,
        sessionId: run.sessionId,
        provider: run.provider,
        model: run.model,
        trigger: run.triggerSlug ? `${run.triggerSource ?? 'unknown'}:${run.triggerSlug}` : run.triggerSource,
        steps: run.stepCount,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        totalTokens: run.totalTokens,
        costUsd: run.costMicros === null ? null : run.costMicros / 1_000_000,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
        // Set on the run of a script routine once it ended with a code.
        exitCode: run.exitCode ?? null,
    }
}
