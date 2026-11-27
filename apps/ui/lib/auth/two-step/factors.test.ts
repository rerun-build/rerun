import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { Factor } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { methodCount, ownMethods } from './factors'

const factor = (id: string, friendly_name?: string, status: Factor['status'] = 'verified') => ({ id, friendly_name, status, factor_type: 'totp', created_at: '', updated_at: '' }) as Factor
const passkey = { id: 'pk', credentialId: 'c', publicKey: 'k', counter: 0, name: 'Mac', createdAt: '', lastUsedAt: null }

describe('ownMethods', () => {
    it('counts the passkeys the hub keeps, with no factor of Supabase behind them', () => {
        const methods = ownMethods({ factors: [factor('recovery', TWO_STEP_RECOVERY_FACTOR_NAME)] }, { recovery: { factorId: 'recovery', sealedSecret: 's' }, passkeys: [passkey] })
        expect(methods.app).toBeUndefined()
        expect(methodCount(methods)).toBe(1)
    })

    it('finds the authenticator app, never the hub recovery factor nor a setup left half way', () => {
        const record = { recovery: { factorId: 'renamed', sealedSecret: 's' } }
        expect(ownMethods({ factors: [factor('renamed'), factor('half', undefined, 'unverified')] }, record).app).toBeUndefined()
        expect(ownMethods({ factors: [factor('renamed'), factor('app', 'Authenticator app')] }, record).app?.id).toBe('app')
        expect(methodCount(ownMethods({ factors: [] }, {}))).toBe(0)
    })
})
