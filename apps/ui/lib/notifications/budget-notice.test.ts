import { describe, expect, it } from 'vitest'
import { ACCOUNT_REFUSED_ERROR_CODE, ENGINE_RESTARTED_ERROR_CODE, RERUN_BUDGET_ERROR_CODE, decideBudgetNotice, suppressesErrorEmail } from './budget-notice'

describe('decideBudgetNotice', () => {
    it('inserts and emails a normal workspace on the first notice', () => {
        expect(decideBudgetNotice({ recentNoticeExists: false, isSandbox: false })).toEqual({ insert: true, email: true })
    })

    it('inserts without email for a sandbox workspace', () => {
        expect(decideBudgetNotice({ recentNoticeExists: false, isSandbox: true })).toEqual({ insert: true, email: false })
    })

    it('does nothing while a recent notice exists', () => {
        expect(decideBudgetNotice({ recentNoticeExists: true, isSandbox: false })).toEqual({ insert: false, email: false })
        expect(decideBudgetNotice({ recentNoticeExists: true, isSandbox: true })).toEqual({ insert: false, email: false })
    })
})

describe('suppressesErrorEmail', () => {
    it('suppresses an error carrying the budget code', () => {
        expect(suppressesErrorEmail('error', { errorCode: RERUN_BUDGET_ERROR_CODE })).toBe(true)
        // A restart reports every conversation it interrupted at once.
        expect(suppressesErrorEmail('error', { errorCode: ENGINE_RESTARTED_ERROR_CODE })).toBe(true)
        // An account turned away has one alert of its own.
        expect(suppressesErrorEmail('error', { errorCode: ACCOUNT_REFUSED_ERROR_CODE })).toBe(true)
    })

    it('leaves other errors alone', () => {
        expect(suppressesErrorEmail('error', { errorCode: 'other' })).toBe(false)
        expect(suppressesErrorEmail('error', {})).toBe(false)
        expect(suppressesErrorEmail('error', null)).toBe(false)
        expect(suppressesErrorEmail('error', undefined)).toBe(false)
    })

    it('never suppresses non-error kinds', () => {
        expect(suppressesErrorEmail('done', { errorCode: RERUN_BUDGET_ERROR_CODE })).toBe(false)
        expect(suppressesErrorEmail('info', { errorCode: RERUN_BUDGET_ERROR_CODE })).toBe(false)
    })
})
