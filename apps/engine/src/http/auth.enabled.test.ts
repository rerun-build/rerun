import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-auth-enabled-'))
process.env.RERUN_API_KEY = 'k'

const { describe, expect, it } = await import('vitest')
const { createServer } = await import('./server.js')

const app = createServer()

describe('API key enforcement', () => {
    it('refuses a request with no authorization header', async () => {
        const res = await app.request('/tools')
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'Unauthorized' })
    })

    it('refuses a wrong bearer token', async () => {
        const res = await app.request('/tools', { headers: { authorization: 'Bearer nope' } })
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'Unauthorized' })
    })

    it('lets the right bearer token through', async () => {
        expect((await app.request('/tools', { headers: { authorization: 'Bearer k' } })).status).toBe(200)
    })

    it('accepts the bare key without the Bearer prefix', async () => {
        expect((await app.request('/tools', { headers: { authorization: 'k' } })).status).toBe(200)
    })

    it('refuses a lowercase bearer prefix', async () => {
        expect((await app.request('/tools', { headers: { authorization: 'bearer k' } })).status).toBe(401)
    })

    it('keeps /health public', async () => {
        expect((await app.request('/health')).status).toBe(200)
    })

    it('answers 401 rather than 404 on an unknown route without a key', async () => {
        expect((await app.request('/nowhere')).status).toBe(401)
        expect((await app.request('/nowhere', { headers: { authorization: 'Bearer k' } })).status).toBe(404)
    })

    it('guards the trigger fire endpoint too', async () => {
        const res = await app.request('/agents/someone/triggers/hook/fire', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 't', method: 'POST' }),
        })
        expect(res.status).toBe(401)
    })
})
