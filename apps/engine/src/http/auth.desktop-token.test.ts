import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-auth-desktop-'))
process.env.RERUN_API_KEY = 'k'

const { describe, expect, it, vi } = await import('vitest')

vi.mock('../desktop/apps.js', () => ({ openDesktopApp: vi.fn(async () => {}) }))
vi.mock('../agents/loader.js', async orig => ({ ...(await orig<typeof import('../agents/loader.js')>()), agentExists: () => true }))

const { createServer } = await import('./server.js')
const { issueDesktopToken, stopDesktop } = await import('../desktop/session.js')

const app = createServer()
const post = (agent: string, tail: string, token: string) =>
    app.request(`/agents/${agent}/${tail}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ app: 'terminal' }) })

describe('desktop session token', () => {
    it('opens an app for its own agent', async () => {
        const token = issueDesktopToken('a1')
        expect((await post('a1', 'desktop/apps', token)).status).toBe(200)
    })

    it('is refused for another agent', async () => {
        const token = issueDesktopToken('a1')
        issueDesktopToken('a2')
        expect((await post('a2', 'desktop/apps', token)).status).toBe(401)
    })

    it('is refused on another route of the same agent', async () => {
        const token = issueDesktopToken('a1')
        expect((await post('a1', 'desktop/session', token)).status).toBe(401)
        expect((await post('a1', 'desktop/takeover', token)).status).toBe(401)
        expect((await app.request('/agents/a1/desktop/apps', { method: 'GET', headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
    })

    it('answers 401, not 500, to a malformed escape in the agent segment', async () => {
        const token = issueDesktopToken('a1')
        expect((await post('a%ZZ', 'desktop/apps', token)).status).toBe(401)
        expect((await post('%', 'desktop/apps', token)).status).toBe(401)
    })

    it('is refused when the agent segment is encoded twice (auth and route must see one id)', async () => {
        const token = issueDesktopToken('aA')
        expect((await post('a%2541', 'desktop/apps', token)).status).toBe(401)
    })

    it('still answers the engine key', async () => {
        expect((await post('a1', 'desktop/apps', 'k')).status).toBe(200)
    })

    it('is refused once the desktop stopped', async () => {
        const token = issueDesktopToken('a1')
        await stopDesktop('a1')
        expect((await post('a1', 'desktop/apps', token)).status).toBe(401)
    })
})
