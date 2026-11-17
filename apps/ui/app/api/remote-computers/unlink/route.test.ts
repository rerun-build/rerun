import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_services/remote-computers.service', () => ({ unlinkByToken: vi.fn() }))

const { unlinkByToken } = await import('@/app/api/_services/remote-computers.service')
const { POST } = await import('./route')

const call = (authorization?: string) => POST(new Request('http://hub/api/remote-computers/unlink', { method: 'POST', headers: authorization ? { authorization } : {} }))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/remote-computers/unlink', () => {
    it('unlinks the computer whose token it is', async () => {
        vi.mocked(unlinkByToken).mockResolvedValue(true)
        expect((await call('Bearer rrn_computer_one')).status).toBe(200)
        expect(unlinkByToken).toHaveBeenCalledWith('rrn_computer_one')
    })

    it('refuses a missing token, one it does not know, and says so when it fails', async () => {
        expect((await call()).status).toBe(401)
        expect((await call(`Bearer ${'x'.repeat(201)}`)).status).toBe(401)
        vi.mocked(unlinkByToken).mockResolvedValue(false)
        expect((await call('Bearer rrn_computer_two')).status).toBe(401)
        vi.mocked(unlinkByToken).mockRejectedValue(new Error('db'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect((await call('Bearer rrn_computer_two')).status).toBe(500)
    })
})
