import type { Factor, User } from '@supabase/supabase-js'
import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { TwoStepRecord } from './record'

// The methods the person set up, without the hub's own recovery factor.
export function ownFactors(account: Pick<User, 'factors'>, record: TwoStepRecord): Factor[] {
    return (account.factors ?? []).filter(factor => factor.status === 'verified' && factor.friendly_name !== TWO_STEP_RECOVERY_FACTOR_NAME && factor.id !== record.recovery?.factorId)
}

export function passkeyName(factor: Factor, record: TwoStepRecord): string {
    return record.names?.[factor.id] ?? factor.friendly_name ?? 'Passkey'
}
