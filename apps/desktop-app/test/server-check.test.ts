import { describe, expect, it } from 'vitest'
import { checkServer, type Fetcher } from '../src/main/server-check'

function answering(status: number, body: unknown): Fetcher {
    return async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('checkServer', () => {
    it('accepts a Rerun server that serves this version', async () => {
        const check = await checkServer('https://x', '0.2.0', answering(200, { app: 'rerun', apiVersion: 1, minShellVersion: '0.1.0' }))
        expect(check.status).toBe('ok')
    })

    it('asks an older app to update', async () => {
        const check = await checkServer('https://x', '0.1.0', answering(200, { app: 'rerun', apiVersion: 1, minShellVersion: '0.3.0' }))
        expect(check).toEqual({ status: 'shell-too-old', minShellVersion: '0.3.0' })
    })

    it('tells a site that is not Rerun from a server that does not answer', async () => {
        expect((await checkServer('https://x', '0.1.0', answering(404, {}))).status).toBe('not-rerun')
        expect((await checkServer('https://x', '0.1.0', answering(200, { hello: 'world' }))).status).toBe('not-rerun')
        expect((await checkServer('https://x', '0.1.0', answering(502, {}))).status).toBe('unreachable')
        const failing: Fetcher = async () => {
            throw new TypeError('fetch failed')
        }
        expect((await checkServer('https://x', '0.1.0', failing)).status).toBe('unreachable')
    })
})
