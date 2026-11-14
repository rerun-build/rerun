export function heldSlots(existing: number | null | undefined, derived: number, periodAdvanced: boolean): number {
    if (periodAdvanced || existing == null) return derived
    return Math.max(existing, derived)
}

export type ConnectState = {
    workspaceTrialing: boolean
    stripeSlots: number
    liveConnections: number
    subscriberTrialOpen: boolean
    subscriberTrialAvailable: boolean
}

export type ConnectAllowance = 'free_slot' | 'workspace_trial_slot' | 'subscriber_trial' | 'buy_slot'

export const WORKSPACE_TRIAL_SLOT_CAP = 1

export function connectAllowance(state: ConnectState): ConnectAllowance {
    const trialSlot = state.subscriberTrialOpen ? 1 : 0
    if (state.liveConnections < state.stripeSlots + trialSlot) return 'free_slot'
    if (state.workspaceTrialing) return state.stripeSlots < WORKSPACE_TRIAL_SLOT_CAP && state.liveConnections < WORKSPACE_TRIAL_SLOT_CAP ? 'workspace_trial_slot' : 'buy_slot'
    if (state.stripeSlots === 0 && state.liveConnections === 0 && state.subscriberTrialAvailable) return 'subscriber_trial'
    return 'buy_slot'
}

export function connectionsToPause<T extends { id: string; created_at: string }>(connections: T[], allowed: number): string[] {
    if (connections.length <= allowed) return []
    const newestFirst = [...connections].sort((a, b) => b.created_at.localeCompare(a.created_at))
    return newestFirst.slice(0, connections.length - Math.max(0, allowed)).map(connection => connection.id)
}

export function canRemoveSlot(stripeSlots: number, liveConnections: number): boolean {
    return stripeSlots > 0 && liveConnections < stripeSlots
}
