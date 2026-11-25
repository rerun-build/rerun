import { describe, expect, it } from 'vitest'

import { isTeamSession } from './team-session'

describe('isTeamSession', () => {
    it('holds for the account the team opened', () => {
        expect(isTeamSession('user-ada', 'user-ada')).toBe(true)
    })

    it('says nothing about another account of the same browser', () => {
        expect(isTeamSession('user-ada', 'user-grace')).toBe(false)
    })

    it('does not hold without a cookie nor without a session', () => {
        expect(isTeamSession(undefined, 'user-ada')).toBe(false)
        expect(isTeamSession('', null)).toBe(false)
        expect(isTeamSession(undefined, undefined)).toBe(false)
    })
})
