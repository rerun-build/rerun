import { TRIAL_ACTIVE_AGENTS } from '@rerun/contracts'

import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'

export { TRIAL_ACTIVE_AGENTS }

export function activeAgentLimitFor(maxAgents: number | null, status: string | null | undefined): number | null {
    if (!isSubscriptionEntitled(status)) return 0
    return maxAgents
}
