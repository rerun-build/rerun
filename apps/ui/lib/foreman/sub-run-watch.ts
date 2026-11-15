import type { SubRunStatus, SubRunTask } from '@/lib/chat/sub-run-progress'

export const SUB_RUN_HEARTBEAT_MS = 30_000

export type SubRunProgress = {
    title: string
    status: SubRunStatus
    steps: number
    activity?: string
    preview?: string
    startedAt?: number
    lastActivityAt?: number
    finishedAt?: number
    error?: string
}

export function snapshotSubRun({ lastActivityAt, ...rest }: SubRunProgress): SubRunTask {
    return rest.status === 'running' && lastActivityAt !== undefined ? { ...rest, idleMs: Date.now() - lastActivityAt } : rest
}

export function beginSubRun(progress: SubRunProgress): void {
    progress.status = 'running'
    progress.startedAt = Date.now()
    progress.lastActivityAt = progress.startedAt
}

export function endSubRun(progress: SubRunProgress, error?: string): void {
    progress.status = error === undefined ? 'done' : 'error'
    progress.error = error
    progress.finishedAt = Date.now()
}

export function startHeartbeat(emit: () => void): () => void {
    const timer = setInterval(emit, SUB_RUN_HEARTBEAT_MS)
    timer.unref?.()
    return () => clearInterval(timer)
}
