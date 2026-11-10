import { loadMessages } from '@rerun/i18n/messages'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'
import { AccessDeniedError } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/errors'
import { failure, failureOf, refusalOf } from './action-error'

async function translatorFor(locale: 'fr' | 'es') {
    return createTranslator({ locale, messages: await loadMessages(locale), namespace: 'errors' })
}

describe('a refusal sent back by an action', () => {
    it('keeps the English text of the code, so a client that predates the codes reads the same words', () => {
        expect(failure('invitationForEmail', { email: 'ada@acme.test' })).toEqual({
            ok: false,
            error: 'This invitation is for ada@acme.test. Sign in with that email to accept it.',
            code: 'invitationForEmail',
            params: { email: 'ada@acme.test' },
        })
    })

    it('carries the code of an authorization refusal thrown deep in a service', () => {
        expect(failureOf(new AccessDeniedError())).toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })
        expect(refusalOf(new AuthorizationError('coworkerNotFound'))).toEqual({ error: 'Coworker not found', code: 'coworkerNotFound' })
    })

    it('passes the text of any other error through, without a code', () => {
        expect(failureOf(new Error('engine said no'), 'saveFileFailed')).toEqual({ ok: false, error: 'engine said no', code: undefined })
        expect(failureOf('not an error', 'saveFileFailed')).toEqual({ ok: false, error: 'Failed to save file', code: 'saveFileFailed' })
    })

    it('reads in the language of the person who sees it', async () => {
        const { code, params } = failure('tooManyActiveKeys', { max: 20 })
        expect((await translatorFor('fr'))(code!, params as never)).toBe('Ce workspace a déjà 20 clés actives. Révoquez-en une pour en créer une autre.')
        expect((await translatorFor('es'))(code!, params as never)).toBe('Este workspace ya tiene 20 claves activas. Revoca una para crear otra.')
    })
})
