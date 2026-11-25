import { isOpenable, type ConsoleWorkspace } from './types'

export const LOW_RUNWAY_DAYS = 14
export const DISK_CRITICAL = 90

export type WorkspaceAlert =
    | { kind: 'outOfCredit'; severe: true }
    | { kind: 'machine'; severe: true }
    | { kind: 'disk'; severe: true; percent: number }
    | { kind: 'invite'; severe: false; email: string; expired: boolean }
    | { kind: 'lowCredit'; severe: false; days: number }

// How many days its credit lasts at the pace of its month, null when it has spent nothing.
export function runwayDays({ creditMicros, spentPerDayMicros }: Pick<ConsoleWorkspace, 'creditMicros' | 'spentPerDayMicros'>): number | null {
    if (spentPerDayMicros <= 0) return null
    return Math.max(Math.floor(creditMicros / spentPerDayMicros), 0)
}

// The one thing the agency has to do about a workspace, the worst first.
export function alertOf(workspace: ConsoleWorkspace): WorkspaceAlert | null {
    const { status, machine, diskPercent, pendingAdmin } = workspace
    if (!isOpenable(status)) return machine === 'error' ? { kind: 'machine', severe: true } : null
    if (status === 'outOfCredit') return { kind: 'outOfCredit', severe: true }
    if (machine === 'error') return { kind: 'machine', severe: true }
    if (diskPercent !== null && diskPercent >= DISK_CRITICAL) return { kind: 'disk', severe: true, percent: diskPercent }
    if (pendingAdmin) return { kind: 'invite', severe: false, email: pendingAdmin.email, expired: pendingAdmin.expired }
    const days = runwayDays(workspace)
    return days !== null && days < LOW_RUNWAY_DAYS ? { kind: 'lowCredit', severe: false, days } : null
}

// Put away, or on its way there or back.
export function isQuiet({ status }: Pick<ConsoleWorkspace, 'status'>): boolean {
    return !isOpenable(status)
}

function rank(workspace: ConsoleWorkspace): number {
    const alert = alertOf(workspace)
    if (alert) return alert.severe ? 0 : 1
    if (isQuiet(workspace)) return 4
    return workspace.status === 'provisioning' ? 3 : 2
}

export function byAttention(workspaces: ConsoleWorkspace[]): ConsoleWorkspace[] {
    return [...workspaces].sort((a, b) => rank(a) - rank(b))
}

export function countAlerts(workspaces: ConsoleWorkspace[]): number {
    return workspaces.filter(workspace => alertOf(workspace)).length
}

// Whose credit ends first: out of it, then the shortest runway, then the ones that spend nothing.
export function byRunway(workspaces: ConsoleWorkspace[]): ConsoleWorkspace[] {
    const urgency = (workspace: ConsoleWorkspace) => (workspace.creditMicros <= 0 ? -1 : (runwayDays(workspace) ?? Infinity))
    return workspaces
        .filter(workspace => workspace.status !== 'archived' && workspace.status !== 'archiving')
        .sort((a, b) => {
            const [left, right] = [urgency(a), urgency(b)]
            return left === right ? 0 : left < right ? -1 : 1
        })
}
