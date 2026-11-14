export const TRIAL_CARD_EXPERIMENT = 'trial_card_v2'

export const TRIAL_CARD_EXPERIMENT_STARTED_AT = Date.parse('2026-10-22T14:00:00Z')

export const TRIAL_CARD_SHARE = 1

export const TRIAL_CARD_PROPERTY = 'ab_trial_card'

export type TrialArm = 'card' | 'cardless'

function unitHash(input: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    hash ^= hash >>> 16
    hash = Math.imul(hash, 0x85ebca6b)
    hash ^= hash >>> 13
    hash = Math.imul(hash, 0xc2b2ae35)
    hash ^= hash >>> 16
    return (hash >>> 0) / 0x1_0000_0000
}

export function trialArm(workspaceId: number, share = TRIAL_CARD_SHARE): TrialArm {
    return unitHash(`${TRIAL_CARD_EXPERIMENT}:${workspaceId}`) < share ? 'card' : 'cardless'
}
