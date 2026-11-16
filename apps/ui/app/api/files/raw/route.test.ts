import { resolveRunTarget } from '@/app/api/_services/chat.service'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import * as engine from '@/lib/engine/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/app/api/_services/chat.service', () => ({ resolveRunTarget: vi.fn() }))
vi.mock('@/app/api/_auth/workspace-target', () => ({ requireWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ fetchRawFile: vi.fn() }))

describe('GET /api/files/raw', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveRunTarget).mockResolvedValue({
            engineAgentId: 'engine-agent',
            conn: { baseUrl: 'https://engine.test', apiKey: null },
        })
    })

    it('streams the raw bytes of a file', async () => {
        const bytes = new Uint8Array([0, 127, 255])
        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response(bytes, {
            headers: { 'Content-Type': 'application/octet-stream' },
        }))

        const response = await GET(new Request('https://rerun.test/api/files/raw?agentId=agent&path=recording.webm'))

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('audio/webm')
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
        expect(engine.fetchRawFile).toHaveBeenCalledWith(
            { baseUrl: 'https://engine.test', apiKey: null },
            '/agents/engine-agent/files',
            'recording.webm',
            null,
        )
    })

    it('serves the shared folder of the workspace off the session alone', async () => {
        vi.mocked(requireWorkspaceConnection).mockResolvedValue({ baseUrl: 'https://engine.test', apiKey: 'k' })
        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response(new Uint8Array([1]), {
            headers: { 'Content-Type': 'application/octet-stream' },
        }))

        const response = await GET(new Request('https://rerun.test/api/files/raw?scope=shared&path=notes.txt'))

        expect(response.status).toBe(200)
        expect(resolveRunTarget).not.toHaveBeenCalled()
        expect(engine.fetchRawFile).toHaveBeenCalledWith({ baseUrl: 'https://engine.test', apiKey: 'k' }, '/shared/files', 'notes.txt', null)
    })

    it('relays a byte range both ways, so Safari can play a video', async () => {
        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response(new Uint8Array([1, 2]), {
            status: 206,
            headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/1000', 'Content-Length': '2', 'Accept-Ranges': 'bytes' },
        }))

        const response = await GET(new Request('https://rerun.test/api/files/raw?agentId=agent&path=clip.mp4', { headers: { Range: 'bytes=0-1' } }))

        expect(response.status).toBe(206)
        expect(response.headers.get('Content-Range')).toBe('bytes 0-1/1000')
        expect(response.headers.get('Accept-Ranges')).toBe('bytes')
        expect(response.headers.get('Content-Type')).toBe('video/mp4')
        expect(engine.fetchRawFile).toHaveBeenCalledWith({ baseUrl: 'https://engine.test', apiKey: null }, '/agents/engine-agent/files', 'clip.mp4', 'bytes=0-1')
    })

    it('relays a range past the end of the file as such', async () => {
        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */1000' } }))

        const response = await GET(new Request('https://rerun.test/api/files/raw?agentId=agent&path=clip.mp4', { headers: { Range: 'bytes=5000-' } }))

        expect(response.status).toBe(416)
        expect(response.headers.get('Content-Range')).toBe('bytes */1000')
    })

    it('downloads an html file instead of rendering it on the app origin, whatever the engine says', async () => {
        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response('<script>alert(1)</script>', {
            headers: { 'Content-Type': 'text/html' },
        }))

        const response = await GET(new Request('https://rerun.test/api/files/raw?agentId=agent&path=reports/rapport.html'))

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('Content-Disposition')).toBe("attachment; filename*=UTF-8''rapport.html")
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    })

    it('keeps an image and a pdf inline, with the type decided by the extension', async () => {
        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'application/octet-stream' } }))
        const image = await GET(new Request('https://rerun.test/api/files/raw?agentId=agent&path=chart.png'))
        expect(image.headers.get('Content-Type')).toBe('image/png')
        expect(image.headers.get('Content-Disposition')).toBe("inline; filename*=UTF-8''chart.png")
        expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff')

        vi.mocked(engine.fetchRawFile).mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'text/html' } }))
        const pdf = await GET(new Request('https://rerun.test/api/files/raw?agentId=agent&path=deck.pdf'))
        expect(pdf.headers.get('Content-Type')).toBe('application/pdf')
        expect(pdf.headers.get('Content-Disposition')).toBe("inline; filename*=UTF-8''deck.pdf")
    })

    it('refuses a request that names neither an agent nor the shared scope', async () => {
        const response = await GET(new Request('https://rerun.test/api/files/raw?path=notes.txt'))

        expect(response.status).toBe(400)
        expect(engine.fetchRawFile).not.toHaveBeenCalled()
    })

    it('still requires an authorized agent target', async () => {
        vi.mocked(resolveRunTarget).mockRejectedValue(new Error('Agent not found'))

        const response = await GET(new Request('https://rerun.test/api/files/raw?agentId=other-agent&path=image.png'))

        expect(response.status).toBe(500)
        expect(engine.fetchRawFile).not.toHaveBeenCalled()
    })
})
