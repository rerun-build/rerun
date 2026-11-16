import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

import { validTimeZone } from './activity.service'

describe('validTimeZone', () => {
    it('keeps a zone the runtime knows', () => {
        expect(validTimeZone('Europe/Paris')).toBe('Europe/Paris')
        expect(validTimeZone('America/New_York')).toBe('America/New_York')
    })

    it('drops anything else', () => {
        expect(validTimeZone('Mars/Olympus')).toBeNull()
        expect(validTimeZone('')).toBeNull()
        expect(validTimeZone(null)).toBeNull()
        expect(validTimeZone('x'.repeat(100))).toBeNull()
    })
})
