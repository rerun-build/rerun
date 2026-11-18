import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { listAiConnectionsWithOffers } from '@/app/api/_services/ai-connection.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceId: vi.fn() }))
vi.mock('@/app/api/_services/ai-connection.service', () => ({ listAiConnectionsWithOffers: vi.fn() }))

const LIST = { connections: [], default: null, backups: { backups: [], rerunCreditLastResort: false }, opencodeOffered: false, customOffered: false }

beforeEach(() => {
    vi.mocked(requireWorkspaceId).mockReset()
    vi.mocked(listAiConnectionsWithOffers).mockReset()
})

describe('GET /api/ai-connections', () => {
    it('refuses a request with no session', async () => {
        vi.mocked(requireWorkspaceId).mockRejectedValue(new Error('unauthenticated'))
        const res = await GET()
        expect(res.status).toBe(401)
        expect(listAiConnectionsWithOffers).not.toHaveBeenCalled()
    })

    it("answers with the workspace's list read fresh, never cached", async () => {
        vi.mocked(requireWorkspaceId).mockResolvedValue(7)
        vi.mocked(listAiConnectionsWithOffers).mockResolvedValue(LIST)
        const res = await GET()
        expect(listAiConnectionsWithOffers).toHaveBeenCalledWith(7, { fresh: true })
        expect(res.headers.get('Cache-Control')).toBe('no-store')
        expect(await res.json()).toEqual(LIST)
    })

    it('says the engine did not answer rather than handing back an empty list', async () => {
        vi.mocked(requireWorkspaceId).mockResolvedValue(7)
        vi.mocked(listAiConnectionsWithOffers).mockRejectedValue(new Error('engine down'))
        expect((await GET()).status).toBe(502)
    })
})
