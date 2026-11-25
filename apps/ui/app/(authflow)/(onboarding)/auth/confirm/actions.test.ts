import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TEAM_SESSION_COOKIE } from '@/lib/auth/team-session'
import { routes } from '@/lib/routes'

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), set: vi.fn(), remove: vi.fn() }))

vi.mock('@/supabase/server', () => ({ createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }) }))
vi.mock('@rerun/analytics/server', () => ({ captureServer: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: mocks.set, delete: mocks.remove }) }))
vi.mock('next/navigation', () => ({
    redirect: (path: string) => {
        throw new Error(`redirect ${path}`)
    },
}))

const { confirmLogin } = await import('./actions')

function form(extra: Record<string, string> = {}) {
    const data = new FormData()
    for (const [name, value] of Object.entries({ token_hash: 'hash', type: 'magiclink', ...extra })) data.set(name, value)
    return data
}

const teamCookie = () => mocks.set.mock.calls.find(([name]) => name === TEAM_SESSION_COOKIE)

beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: 'user-ada', email: 'ada@example.com' } }, error: null })
})

describe('confirmLogin', () => {
    it('remembers the account the team opened, out of reach of the page', async () => {
        await expect(confirmLogin(form({ team: '1' }))).rejects.toThrow(`redirect ${routes.home}`)
        expect(teamCookie()).toEqual([TEAM_SESSION_COOKIE, 'user-ada', expect.objectContaining({ httpOnly: true, path: '/' })])
        expect(mocks.remove).not.toHaveBeenCalledWith(TEAM_SESSION_COOKIE)
    })

    it('forgets it when the account signs in with its own link', async () => {
        await expect(confirmLogin(form())).rejects.toThrow(`redirect ${routes.home}`)
        expect(teamCookie()).toBeUndefined()
        expect(mocks.remove).toHaveBeenCalledWith(TEAM_SESSION_COOKIE)
    })

    it('touches nothing on a refused link', async () => {
        mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error('expired') })
        await expect(confirmLogin(form({ team: '1' }))).rejects.toThrow(`redirect ${routes.authCodeError}`)
        expect(mocks.set).not.toHaveBeenCalled()
        expect(mocks.remove).not.toHaveBeenCalled()
    })
})
