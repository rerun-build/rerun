import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-member-routes-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { FOREMAN_INSTRUCTIONS_MAX } = await import('@rerun/contracts')
const { createServer } = await import('../server.js')

const app = createServer()

function instructions(method: 'GET' | 'PUT', member: string, body?: unknown, agent = 'foreman') {
    return app.request(`/agents/${agent}/members/${member}/instructions`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

describe('the instructions of a member on the Chief of Staff', () => {
    it('answers none for a member who never wrote any', async () => {
        const res = await instructions('GET', 'u-new')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ instructions: null })
    })

    it('saves them tidied, reads them back, and clears them with an empty text', async () => {
        const saved = await instructions('PUT', 'u-ana', { instructions: "  Don't call me Ana.\r\n\r\n\r\nBe brief. " })
        expect(saved.status).toBe(200)
        expect(await saved.json()).toEqual({ instructions: "Don't call me Ana.\n\nBe brief." })
        expect(await (await instructions('GET', 'u-ana')).json()).toEqual({ instructions: "Don't call me Ana.\n\nBe brief." })
        expect(await (await instructions('PUT', 'u-ana', { instructions: '' })).json()).toEqual({ instructions: null })
        expect(await (await instructions('GET', 'u-ana')).json()).toEqual({ instructions: null })
    })

    it("keeps one member's apart from another's", async () => {
        await instructions('PUT', 'u-bo', { instructions: 'Call me Mr. Bo.' })
        await instructions('PUT', 'u-cy', { instructions: 'Use formal French.' })
        expect(await (await instructions('GET', 'u-bo')).json()).toEqual({ instructions: 'Call me Mr. Bo.' })
    })

    it('refuses a text over the limit, and something that is not a text, leaving what was there', async () => {
        await instructions('PUT', 'u-di', { instructions: 'Be brief.' })
        expect((await instructions('PUT', 'u-di', { instructions: 'a'.repeat(FOREMAN_INSTRUCTIONS_MAX + 1) })).status).toBe(400)
        expect((await instructions('PUT', 'u-di', { instructions: 42 })).status).toBe(400)
        expect(await (await instructions('GET', 'u-di')).json()).toEqual({ instructions: 'Be brief.' })
    })

    it('answers only on the Chief of Staff', async () => {
        expect((await instructions('GET', 'u-ana', undefined, 'sales')).status).toBe(404)
    })
})
