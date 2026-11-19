import { describe, expect, it } from 'vitest'
import { isNetworkFailure, signInRefusal } from './network-error'

const named = (name: string) => Object.assign(new Error(name), { name })

describe('isNetworkFailure', () => {
    it('recognizes a host that does not answer and a timeout', () => {
        expect(isNetworkFailure(new TypeError('fetch failed'))).toBe(true)
        expect(isNetworkFailure(named('TimeoutError'))).toBe(true)
    })

    it('leaves out a deliberate abort and any other error', () => {
        expect(isNetworkFailure(named('AbortError'))).toBe(false)
        expect(isNetworkFailure(new TypeError('Cannot read properties of undefined'))).toBe(false)
        expect(isNetworkFailure(new Error('fetch failed'))).toBe(false)
        expect(isNetworkFailure('fetch failed')).toBe(false)
    })
})

describe('signInRefusal', () => {
    it('replaces a network failure with a sentence', () => {
        const refusal = signInRefusal(new TypeError('fetch failed'), 'startOAuthFailed')
        expect(refusal.error).not.toContain('fetch failed')
        expect(refusal.error).toMatch(/try again/i)
        expect(refusal.code).toBe('signInServiceUnreachable')
    })

    it('keeps any other message, and the fallback for a non-error', () => {
        expect(signInRefusal(new Error('this server does not advertise an OAuth authorization server'), 'startOAuthFailed').error).toBe('this server does not advertise an OAuth authorization server')
        expect(signInRefusal('nope', 'startOAuthFailed')).toEqual({ error: 'Failed to start OAuth', code: 'startOAuthFailed' })
    })
})
