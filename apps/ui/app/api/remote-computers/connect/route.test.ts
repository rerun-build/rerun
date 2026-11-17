import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_services/remote-computers.service', async () => {
    class ComputerConnectError extends Error {
        constructor(
            readonly reason: string,
            readonly status: number,
        ) {
            super(reason)
        }
    }
    return { ComputerConnectError, connectComputer: vi.fn() }
})

const { ComputerConnectError, connectComputer } = await import('@/app/api/_services/remote-computers.service')
const { POST } = await import('./route')
const { allowConnectAttempt } = await import('./attempts')

const call = (token: string | null, body: unknown = { appVersion: '0.2.0' }) =>
    POST(new Request('http://hub/api/remote-computers/connect', { method: 'POST', headers: token === null ? {} : { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/remote-computers/connect', () => {
    it('answers the socket and the computer for a token the hub issued', async () => {
        vi.mocked(connectComputer).mockResolvedValue({ socketUrl: 'wss://relay/remote/ws?ticket=t', computer: { id: 'c1', handle: 'pc', name: 'PC' }, workspaceId: 7 })
        const res = await call('rrn_computer_one')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ socketUrl: 'wss://relay/remote/ws?ticket=t', computer: { id: 'c1', handle: 'pc', name: 'PC' } })
        expect(res.headers.get('cache-control')).toBe('no-store')
        expect(connectComputer).toHaveBeenCalledWith('rrn_computer_one', '0.2.0')
    })

    it('refuses a request with no token, an oversized one, or a body it cannot read without failing', async () => {
        expect((await call(null)).status).toBe(401)
        expect((await call('x'.repeat(201))).status).toBe(401)
        vi.mocked(connectComputer).mockResolvedValue({ socketUrl: 's', computer: { id: 'c1', handle: 'pc', name: 'PC' }, workspaceId: 7 })
        expect((await call('rrn_computer_two', 'not an object')).status).toBe(200)
        expect(connectComputer).toHaveBeenLastCalledWith('rrn_computer_two', null)
    })

    it('says why it refused, and when to come back', async () => {
        vi.mocked(connectComputer).mockRejectedValueOnce(new ComputerConnectError('revoked', 401))
        const revoked = await call('rrn_computer_three')
        expect([revoked.status, await revoked.json()]).toEqual([401, { error: 'revoked' }])
        vi.mocked(connectComputer).mockRejectedValueOnce(new ComputerConnectError('engine-update', 503))
        const later = await call('rrn_computer_three')
        expect([later.status, later.headers.get('retry-after')]).toEqual([503, '60'])
        vi.mocked(connectComputer).mockRejectedValueOnce(new Error('db down'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect((await call('rrn_computer_three')).status).toBe(500)
    })

    it('slows down a token that tries too often', async () => {
        vi.mocked(connectComputer).mockResolvedValue({ socketUrl: 's', computer: { id: 'c1', handle: 'pc', name: 'PC' }, workspaceId: 7 })
        const statuses: number[] = []
        for (let i = 0; i < 21; i++) statuses.push((await call('rrn_computer_loop')).status)
        expect(statuses.filter(status => status === 429)).toHaveLength(1)
        expect((await call('rrn_computer_other')).status).toBe(200)
    })
})

describe('allowConnectAttempt', () => {
    it('lets a token in again once the minute has passed', () => {
        for (let i = 0; i < 20; i++) expect(allowConnectAttempt('t', 1_000)).toBe(true)
        expect(allowConnectAttempt('t', 1_000)).toBe(false)
        expect(allowConnectAttempt('t', 61_001)).toBe(true)
    })
})
