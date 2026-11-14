import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'key-held-in-memory-only'
let dir: string
let fd: number | null = null

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rerun-keyfd-'))
    vi.resetModules()
    vi.stubEnv('RERUN_API_KEY', undefined)
    vi.stubEnv('RERUN_KEY_FD', undefined)
})

afterEach(() => {
    vi.unstubAllEnvs()
    if (fd !== null) {
        try {
            closeSync(fd)
        } catch {
        }
        fd = null
    }
    rmSync(dir, { recursive: true, force: true })
})

function deliver(content: string): number {
    const file = join(dir, 'key')
    writeFileSync(file, content)
    fd = openSync(file, 'r')
    vi.stubEnv('RERUN_KEY_FD', String(fd))
    return fd
}

describe('key delivered on a descriptor', () => {
    it('is held in memory only and the descriptor is closed after the read', async () => {
        const n = deliver(`${KEY}\n`)
        const { env, takeKeyFromDescriptor } = await import('./env.js')
        takeKeyFromDescriptor()
        expect(env().RERUN_API_KEY).toBe(KEY)
        expect(process.env.RERUN_API_KEY).toBeUndefined()
        expect(process.env.RERUN_KEY_FD).toBeUndefined()
        if (process.platform === 'linux') expect(existsSync(`/proc/self/fd/${n}`)).toBe(false)
    })

    it('stays out of every child environment', async () => {
        deliver(KEY)
        const { takeKeyFromDescriptor, env } = await import('./env.js')
        takeKeyFromDescriptor()
        const { childProcessEnv } = await import('../lib/child-env.js')
        expect(env().RERUN_API_KEY).toBe(KEY)
        expect(Object.values(childProcessEnv({}, { CI: 'true' }))).not.toContain(KEY)
        expect(Object.values(process.env)).not.toContain(KEY)
    })

    it('refuses to start when the descriptor was signalled but not read', async () => {
        deliver(KEY)
        const { env } = await import('./env.js')
        expect(() => env()).toThrow(/descriptor/)
    })

    it('refuses to start when the descriptor holds no key', async () => {
        deliver('\n')
        const { takeKeyFromDescriptor } = await import('./env.js')
        expect(() => takeKeyFromDescriptor()).toThrow(/held no key/)
    })

    it('keeps a self-paired key in the holder, not in the environment', async () => {
        const { env, setEnv } = await import('./env.js')
        setEnv({ RERUN_API_KEY: 'paired-key', RERUN_HUB_BASE_URL: 'https://hub.example.com' })
        expect(env().RERUN_API_KEY).toBe('paired-key')
        expect(process.env.RERUN_API_KEY).toBeUndefined()
        expect(process.env.RERUN_HUB_BASE_URL).toBe('https://hub.example.com')
        vi.unstubAllEnvs()
        delete process.env.RERUN_HUB_BASE_URL
    })

    it('still reads a key given in the start-up environment', async () => {
        vi.stubEnv('RERUN_API_KEY', 'from-env')
        const { env } = await import('./env.js')
        expect(env().RERUN_API_KEY).toBe('from-env')
    })
})
