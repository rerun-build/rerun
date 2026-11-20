import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-auth-open-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { createServer } = await import('./server.js')
const { answersWithoutKeyBeyondThisMachine } = await import('./auth.js')

describe('engine without a key', () => {
    // What docker compose started with an empty RERUN_ENGINE_API_KEY: the reason compose now refuses it.
    it('answers a call that carries no authorization header', async () => {
        expect((await createServer().request('/tools')).status).toBe(200)
    })

    it('is said to answer beyond this machine when it listens on every interface', () => {
        expect(answersWithoutKeyBeyondThisMachine('0.0.0.0', '')).toBe(true)
        expect(answersWithoutKeyBeyondThisMachine('0.0.0.0', undefined)).toBe(true)
        expect(answersWithoutKeyBeyondThisMachine('192.168.1.20', '')).toBe(true)
    })

    it('is quiet when it listens on this machine only', () => {
        expect(answersWithoutKeyBeyondThisMachine('127.0.0.1', '')).toBe(false)
        expect(answersWithoutKeyBeyondThisMachine('localhost', undefined)).toBe(false)
        expect(answersWithoutKeyBeyondThisMachine('::1', '')).toBe(false)
    })

    it('is quiet once a key is set', () => {
        expect(answersWithoutKeyBeyondThisMachine('0.0.0.0', 'k')).toBe(false)
    })
})
