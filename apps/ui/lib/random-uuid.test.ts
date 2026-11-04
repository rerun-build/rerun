import { afterEach, describe, expect, it, vi } from 'vitest'

import { randomUuid } from '@rerun/db/helpers'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
    afterEach(() => {
        // Remove the instance-level shadow so the real webcrypto method shows through again.
        delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID
        vi.restoreAllMocks()
    })

    it('uses crypto.randomUUID in a secure context', () => {
        const spy = vi.spyOn(globalThis.crypto, 'randomUUID')
        const id = randomUuid()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(UUID_V4.test(id)).toBe(true)
    })

    it('falls back to a v4 UUID when randomUUID is unavailable, e.g. plain HTTP on a LAN IP', () => {
        // Simulate a non-secure context: crypto exists but randomUUID does not.
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
        const ids = [randomUuid(), randomUuid(), randomUuid()]
        expect(new Set(ids).size).toBe(3)
        for (const id of ids) expect(UUID_V4.test(id)).toBe(true)
    })
})
