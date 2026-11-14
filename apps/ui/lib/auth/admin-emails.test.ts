import { afterEach, describe, expect, it, vi } from 'vitest'

import { adminEmails, isAdminEmail } from './admin-emails'

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('adminEmails', () => {
    it('reads the server list when the browser one was built empty', () => {
        vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAILS', '')
        vi.stubEnv('ADMIN_EMAILS', 'owner@example.com')
        expect(adminEmails()).toEqual(['owner@example.com'])
        expect(isAdminEmail('Owner@Example.com')).toBe(true)
    })

    it('prefers the browser list when it was built with one', () => {
        vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAILS', 'a@example.com, b@example.com')
        vi.stubEnv('ADMIN_EMAILS', 'other@example.com')
        expect(adminEmails()).toEqual(['a@example.com', 'b@example.com'])
    })

    it('names nobody when neither list is set', () => {
        vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAILS', '')
        vi.stubEnv('ADMIN_EMAILS', '')
        expect(adminEmails()).toEqual([])
        expect(isAdminEmail('owner@example.com')).toBe(false)
    })
})
