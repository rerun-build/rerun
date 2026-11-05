import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintAccessCookie } from './access-ticket'
import { accessCookieHeader, mayOpen, readAccessCookie, safeNextPath, siteFileExists } from './gate'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const SLUG = 'weekly-kpis-p8d2hs0qva'

function cookieFor(grant: 'member' | 'password' | 'invite' | 'shot', v = 3, slug = SLUG): string {
    return mintAccessCookie({ slug, v, grant, sub: 'someone' })
}

describe('mayOpen', () => {
    beforeEach(() => vi.stubEnv('PUBLISHED_ACCESS_SECRET', 'test-secret'))
    afterEach(() => vi.unstubAllEnvs())

    const link = (access: 'public' | 'workspace' | 'password' | 'invited') => ({ slug: SLUG, access, access_version: 3 })

    it('opens a public link to anyone', () => {
        expect(mayOpen(link('public'), null)).toBe(true)
    })

    it('keeps every other link shut without a cookie', () => {
        expect(mayOpen(link('workspace'), null)).toBe(false)
        expect(mayOpen(link('password'), null)).toBe(false)
        expect(mayOpen(link('invited'), null)).toBe(false)
    })

    it('opens any link to a member', () => {
        for (const access of ['workspace', 'password', 'invited'] as const) expect(mayOpen(link(access), cookieFor('member'))).toBe(true)
    })

    it('only takes the grant of the gate the link has', () => {
        expect(mayOpen(link('password'), cookieFor('password'))).toBe(true)
        expect(mayOpen(link('invited'), cookieFor('password'))).toBe(false)
        expect(mayOpen(link('workspace'), cookieFor('invite'))).toBe(false)
    })

    it('stops a cookie once the access changed, or on another link', () => {
        expect(mayOpen(link('password'), cookieFor('password', 2))).toBe(false)
        expect(mayOpen(link('password'), cookieFor('password', 3, 'other-slug-k3m9xqw7pt'))).toBe(false)
    })

    it('reads back the cookie it sets', () => {
        const header = accessCookieHeader({ slug: SLUG, access_version: 3 }, 'password', 'password', true, 60)
        expect(header).toContain('__Host-rr_access=')
        expect(header).toContain('HttpOnly')
        expect(header).toContain('Secure')
        const value = header.split(';')[0]
        expect(mayOpen(link('password'), readAccessCookie(`theme=dark; ${value}`, true))).toBe(true)
    })
})

describe('safeNextPath', () => {
    it('keeps a path of the same host', () => {
        expect(safeNextPath('/about?x=1')).toBe('/about?x=1')
    })

    it('never leads off the host nor into the reserved paths', () => {
        expect(safeNextPath('https://evil.com')).toBe('/')
        expect(safeNextPath('//evil.com')).toBe('/')
        expect(safeNextPath('/\\evil.com')).toBe('/')
        expect(safeNextPath('/__rerun/logout')).toBe('/')
        expect(safeNextPath(null)).toBe('/')
    })
})

describe('siteFileExists', () => {
    it('answers for the files of a site only', () => {
        const site = { kind: 'site', files: ['index.html', '_next/static/app.js'] }
        expect(siteFileExists(site, '/_next/static/app.js')).toBe(true)
        expect(siteFileExists(site, '/_next/static/other.js')).toBe(false)
        expect(siteFileExists({ kind: 'file', files: null }, '/_next/static/app.js')).toBe(false)
    })
})
