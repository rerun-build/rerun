export const TRIAL_BLOCKED_CARD_REUSE = 'card_fingerprint_reuse'

export function isTrialCardReuseBlocked(): boolean {
    return process.env.TRIAL_CARD_REUSE_BLOCK === 'true'
}

export type TrialCardClaim = { id: string; workspace_id: number | null; created_at: string }

export function ownsTrialClaim(claims: TrialCardClaim[], workspaceId: number): boolean {
    const first = [...claims].sort(compareClaims)[0]
    if (!first) return true
    return first.workspace_id === workspaceId
}

function compareClaims(a: TrialCardClaim, b: TrialCardClaim): number {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return a.id < b.id ? -1 : 1
}
