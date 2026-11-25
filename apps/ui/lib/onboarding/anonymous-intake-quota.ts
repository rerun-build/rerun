// How much of the welcome card one workspace may spend. Each call is a model decision paid by
// Rerun: the card gets what a person answering it needs and a script replaying it gets
// nothing more, whether the visitor has an account yet or not.
//
// Held in memory, per process: a deploy or a second replica only hands a workspace a larger
// allowance, never takes one away.

export type IntakeCall = 'decide'

export const INTAKE_QUOTA: Record<IntakeCall, number> = { decide: 10 }

// Past this many workspaces the oldest are forgotten, so the map cannot grow with the traffic.
const MAX_TRACKED_WORKSPACES = 5000

const spent = new Map<number, Record<IntakeCall, number>>()

export function takeIntakeCall(workspaceId: number, call: IntakeCall): boolean {
    const counts = spent.get(workspaceId) ?? { decide: 0 }
    if (counts[call] >= INTAKE_QUOTA[call]) return false
    counts[call] += 1
    spent.delete(workspaceId)
    spent.set(workspaceId, counts)
    if (spent.size > MAX_TRACKED_WORKSPACES) spent.delete(spent.keys().next().value as number)
    return true
}
