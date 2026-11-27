import type { Factor, User } from '@supabase/supabase-js'
import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { StoredPasskey, TwoStepRecord } from './record'

export type OwnMethods = { app: Factor | undefined; passkeys: StoredPasskey[] }

// The methods the person set up: their authenticator app, a factor of Supabase's, and their passkeys,
// kept by the hub. Never the hub's own recovery factor.
export function ownMethods(account: Pick<User, 'factors'>, record: TwoStepRecord): OwnMethods {
    const app = (account.factors ?? []).find(factor => factor.status === 'verified' && factor.factor_type === 'totp' && factor.friendly_name !== TWO_STEP_RECOVERY_FACTOR_NAME && factor.id !== record.recovery?.factorId)
    return { app, passkeys: record.passkeys ?? [] }
}

export function methodCount(methods: OwnMethods): number {
    return (methods.app ? 1 : 0) + methods.passkeys.length
}
