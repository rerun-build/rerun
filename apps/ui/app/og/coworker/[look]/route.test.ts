import { beforeEach, describe, expect, it, vi } from 'vitest'

const capturePage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/og/shot', () => ({ capturePage }))

const { GET } = await import('./route')

const get = (look: string) => GET(new Request(`https://app.rerun.build/og/coworker/${look}`), { params: Promise.resolve({ look }) })

describe('GET /og/coworker/[look]', () => {
    beforeEach(() => capturePage.mockReset())

    it('captures a look once, then serves it from memory', async () => {
        capturePage.mockResolvedValue({ body: Buffer.from('png'), contentType: 'image/png' })
        const first = await get('pill-smile-0f52ff-classic')
        expect(first.status).toBe(200)
        expect(first.headers.get('content-type')).toBe('image/png')
        expect(await first.text()).toBe('png')
        expect((await get('pill-smile-0f52ff-classic')).status).toBe(200)
        expect(capturePage).toHaveBeenCalledTimes(1)
    })

    it('captures a look once for those who ask at the same time', async () => {
        capturePage.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ body: Buffer.from('png'), contentType: 'image/png' }), 20)))
        const answers = await Promise.all([get('wink-flat-e935c1-felt'), get('wink-flat-e935c1-felt'), get('wink-flat-e935c1-felt')])
        expect(answers.map(answer => answer.status)).toEqual([200, 200, 200])
        expect(capturePage).toHaveBeenCalledTimes(1)
    })

    it('refuses a look nobody can wear without starting a browser', async () => {
        expect((await get('pill-smile-ffffff-classic')).status).toBe(404)
        expect(capturePage).not.toHaveBeenCalled()
    })

    it('answers an uncached error when the capture fails, and tries again', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        capturePage.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ body: Buffer.from('png'), contentType: 'image/png' })
        const failed = await get('round-cat-00b862-clay')
        expect(failed.status).toBe(502)
        expect(failed.headers.get('cache-control')).toBe('no-store')
        expect((await get('round-cat-00b862-clay')).status).toBe(200)
    })
})
