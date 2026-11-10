import { describe, expect, it } from 'vitest'
import { oauthErrorCode, oauthRetryCopy, withoutOAuthError } from './oauth-error'
import { englishTranslator } from '@/lib/i18n/english-translator'

const t = englishTranslator('auth.oauthRetry')

const FAILED = 'https://app.rerun.build/?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired'

describe('oauthErrorCode', () => {
    it('reads the code Supabase put in the query', () => {
        expect(oauthErrorCode(new URL(FAILED))).toBe('bad_oauth_state')
    })

    it('reads it from the fragment too', () => {
        expect(oauthErrorCode(new URL('https://app.rerun.build/#error=access_denied&error_description=denied'))).toBe('access_denied')
    })

    it('ignores a bare `error` some other flow may use', () => {
        expect(oauthErrorCode(new URL('https://app.rerun.build/?error=1'))).toBeNull()
        expect(oauthErrorCode(new URL('https://app.rerun.build/?billing=success'))).toBeNull()
    })
})

describe('withoutOAuthError', () => {
    it('drops the three params and keeps everything else', () => {
        expect(withoutOAuthError(new URL(`${FAILED}&template=seo`)).href).toBe('https://app.rerun.build/?template=seo')
    })

    it('drops a fragment that carries the error, and only that one', () => {
        expect(withoutOAuthError(new URL('https://app.rerun.build/#error=x&error_code=bad_oauth_state')).href).toBe('https://app.rerun.build/')
        expect(withoutOAuthError(new URL('https://app.rerun.build/#section')).href).toBe('https://app.rerun.build/#section')
    })
})

describe('oauthRetryCopy', () => {
    it('says the provider took too long when the state expired', () => {
        expect(oauthRetryCopy('bad_oauth_state', 'Google', t)).toEqual({
            title: "Let's try that again",
            subtitle: 'Google took more than 5 minutes to send you back, so it expired. Your answers are kept.',
        })
    })

    it('falls back on a neutral subject when the provider is unknown', () => {
        expect(oauthRetryCopy('bad_oauth_state', null, t).subtitle).toBe('Signing in took more than 5 minutes, so it expired. Your answers are kept.')
    })

    it('tells a cancel from a failure', () => {
        expect(oauthRetryCopy('access_denied', 'Apple', t).title).toBe('Sign-in was cancelled')
        expect(oauthRetryCopy('server_error', 'Google', t).title).toBe("Sign-in didn't go through")
    })
})
