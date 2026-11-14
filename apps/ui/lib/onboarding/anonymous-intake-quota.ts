export type IntakeCall = 'decide' | 'explore'

export const INTAKE_QUOTA: Record<IntakeCall, number> = { decide: 10, explore: 3 }

const MAX_TRACKED_WORKSPACES = 5000

const spent = new Map<number, Record<IntakeCall, number>>()

export function takeIntakeCall(workspaceId: number, call: IntakeCall): boolean {
    const counts = spent.get(workspaceId) ?? { decide: 0, explore: 0 }
    if (counts[call] >= INTAKE_QUOTA[call]) return false
    counts[call] += 1
    spent.delete(workspaceId)
    spent.set(workspaceId, counts)
    if (spent.size > MAX_TRACKED_WORKSPACES) spent.delete(spent.keys().next().value as number)
    return true
}
