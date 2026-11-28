import { describe, expect, it } from 'vitest'

import { heldAccountsSignedOut } from './connections'

describe('heldAccountsSignedOut', () => {
    const held = (...statuses: string[]) => statuses.map(status => ({ status }))

    it('is signed out only when every account held waits on a reconnect, or is halfway through one', () => {
        expect(heldAccountsSignedOut(held('needs_reconnect'))).toBe(true)
        expect(heldAccountsSignedOut(held('needs_reconnect', 'needs_reconnect'))).toBe(true)
        expect(heldAccountsSignedOut(held('connecting'))).toBe(true)
        expect(heldAccountsSignedOut(held('connecting', 'connected'))).toBe(false)
    })

    it('is not while one account still works, one is only paused, or none is held', () => {
        expect(heldAccountsSignedOut(held('connected', 'needs_reconnect'))).toBe(false)
        expect(heldAccountsSignedOut(held('paused'))).toBe(false)
        expect(heldAccountsSignedOut([])).toBe(false)
    })
})
