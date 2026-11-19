import { CheckCheck, Clock, CircleX, GitMerge, Hammer, Hourglass, Link2, OctagonPause, OctagonX, ScanEye, ShieldCheck, TriangleAlert, Undo2, Wrench, type LucideIcon } from 'lucide-react'
import type { FactoryJobState } from '@moldwright/contracts'
import { STATUS_COLOR } from './factory-scene'

const GREY = '#9ca3af'

export const JOB_STATE_VIEW: Record<FactoryJobState, { icon: LucideIcon; color: string; dim?: boolean }> = {
    waiting: { icon: Link2, color: STATUS_COLOR.queued, dim: true },
    queued: { icon: Clock, color: STATUS_COLOR.queued },
    building: { icon: Hammer, color: STATUS_COLOR.build },
    review_wait: { icon: Hourglass, color: STATUS_COLOR.review },
    reviewing: { icon: ScanEye, color: STATUS_COLOR.review },
    fix_wait: { icon: TriangleAlert, color: STATUS_COLOR.fixing },
    fixing: { icon: Wrench, color: STATUS_COLOR.fixing },
    checks: { icon: ShieldCheck, color: STATUS_COLOR.checks },
    proof_wait: { icon: Hourglass, color: STATUS_COLOR.review },
    proving: { icon: ScanEye, color: STATUS_COLOR.review },
    merged: { icon: GitMerge, color: STATUS_COLOR.complete },
    rejected: { icon: OctagonX, color: STATUS_COLOR.rejected },
    blocked: { icon: OctagonPause, color: STATUS_COLOR.rejected },
    failed: { icon: CircleX, color: GREY },
    returned: { icon: Undo2, color: GREY },
    superseded: { icon: CheckCheck, color: GREY, dim: true },
    unsolvable: { icon: OctagonX, color: STATUS_COLOR.rejected },
}

export type JobGroup = 'active' | 'waiting' | 'ended'

export const JOB_GROUPS: Record<JobGroup, FactoryJobState[]> = {
    active: ['building', 'review_wait', 'reviewing', 'fix_wait', 'fixing', 'checks', 'proof_wait', 'proving'],
    waiting: ['waiting', 'queued'],
    ended: ['merged', 'rejected', 'blocked', 'failed', 'returned', 'superseded', 'unsolvable'],
}

export function groupOf(state: FactoryJobState): JobGroup {
    return (Object.keys(JOB_GROUPS) as JobGroup[]).find((g) => JOB_GROUPS[g].includes(state)) ?? 'ended'
}

export const LOADER_TILE = 'Delegator'
