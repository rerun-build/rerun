import 'server-only'

import { sleep } from '@moldwright/contracts'
import type { Json } from '@/app/api/database.types'
import type { SubRunTask } from '@/lib/chat/sub-run-progress'
import { claimBuild, finishedBuild, releaseBuild } from './build-claim'
import { buildTeam, titleOf, type BuildTeamOptions, type BuildTeamResult } from './build-team'
import type { ForemanState } from './phase'
import { beginSubRun, snapshotSubRun, startHeartbeat, type SubRunProgress } from './sub-run-watch'

export const BUILD_STILL_RUNNING = 'The team is still being built. It will be on the board in a moment.'
const ALREADY_BUILT = 'The team is already on the board.'

const POLL_MS = 500
const WAIT_TIMEOUT_MS = 5 * 60_000
const ATTEMPTS = 2

type StoredBuild = { result: BuildTeamResult; tasks: SubRunTask[] }

export type BuildTeamOnceOptions = BuildTeamOptions & {
    reload: () => Promise<ForemanState>
    pollMs?: number
    timeoutMs?: number
}

function readStored(value: Json | null | undefined): StoredBuild | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { result, tasks } = value as Partial<StoredBuild>
    return result && Array.isArray(result.agents) && Array.isArray(tasks) ? { result, tasks } : null
}

export async function buildTeamOnce({ ctx, state, emit, signal, reload, pollMs = POLL_MS, timeoutMs = WAIT_TIMEOUT_MS }: BuildTeamOnceOptions): Promise<BuildTeamResult> {
    const workspaceId = ctx.workspace.id
    let waited: StoredBuild | null = null

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const claim = await claimBuild(workspaceId)
        if (claim) return runClaimed({ ctx, emit, signal, reload, claimedAt: claim.claimedAt, previous: readStored(claim.previous) })

        const finished = await waitForBuild(workspaceId, state, emit, signal, pollMs, timeoutMs)
        if (!finished) throw new Error(BUILD_STILL_RUNNING)
        waited = readStored(finished.result) ?? waited
        if (waited?.result.agents.length) break
    }

    if (!waited) throw new Error(BUILD_STILL_RUNNING)
    emit(waited.tasks)
    return waited.result
}

async function runClaimed({ ctx, emit, signal, reload, claimedAt, previous }: Pick<BuildTeamOnceOptions, 'ctx' | 'emit' | 'signal' | 'reload'> & { claimedAt: string; previous: StoredBuild | null }): Promise<BuildTeamResult> {
    let built: StoredBuild | null = null
    try {
        const state = await reload()
        if (state.phase !== 'build') {
            if (!previous) throw new Error(ALREADY_BUILT)
            built = previous
            emit(previous.tasks)
            return previous.result
        }
        let tasks: SubRunTask[] = []
        const result = await buildTeam({
            ctx,
            state,
            signal,
            emit: next => {
                tasks = next
                emit(next)
            },
        })
        built = { result, tasks }
        return result
    } finally {
        await releaseBuild(ctx.workspace.id, claimedAt, built as unknown as Json).catch(err => console.error('[foreman] could not release the team build:', err instanceof Error ? err.message : err))
    }
}

async function waitForBuild(workspaceId: number, state: ForemanState, emit: (tasks: SubRunTask[]) => void, signal: AbortSignal | undefined, pollMs: number, timeoutMs: number) {
    const progress = (state.foreman.plan?.items ?? []).map((item): SubRunProgress => ({ title: titleOf(item), status: 'queued', steps: 0 }))
    for (const task of progress) beginSubRun(task)
    const publish = () => emit(progress.map(snapshotSubRun))
    publish()
    const stopHeartbeat = startHeartbeat(publish)
    try {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline && !signal?.aborted) {
            await sleep(pollMs)
            const finished = await finishedBuild(workspaceId)
            if (finished) return finished
        }
        return null
    } finally {
        stopHeartbeat()
    }
}
