'use server'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { UsageNotSupportedError, readWorkspaceUsage, type WorkspaceUsage } from '@/app/api/_services/usage.service'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { usageRunsQuerySchema, type UsageRunsQuery } from '@rerun/contracts'

export type WorkspaceUsageResult = { ok: true; usage: WorkspaceUsage } | { ok: false; reason: 'noEngine' | 'unreachable' | 'outdated' }

// The usage dialog: every member reads the runs of the coworkers they reach.
export async function readWorkspaceUsageAction(query: UsageRunsQuery): Promise<WorkspaceUsageResult> {
    const ctx = await requireWorkspaceContext()
    try {
        return { ok: true, usage: await readWorkspaceUsage(ctx, usageRunsQuerySchema.parse(query)) }
    } catch (err) {
        return { ok: false, reason: err instanceof NoEngineError ? 'noEngine' : err instanceof UsageNotSupportedError ? 'outdated' : 'unreachable' }
    }
}
