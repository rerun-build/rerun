import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cx-loader-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, rm, writeFile } = await import('node:fs/promises')
const { boxDefaultPath, connectionConfigPath, connectionDir, connectionEnvPath, connectionsDir, connectionsMigratedPath } = await import('../config/paths.js')
const { connectionExists, isConnected, listConnectionIds, loadConnectionFromDisk, toSummary } = await import('./loader.js')
const { recordCredentialRejected } = await import('./credential-rejections.js')

const config = { name: 'Conn', provider: 'anthropic', models: ['m1'], extraModels: [], createdAt: '2026-01-01T00:00:00.000Z' } as const

function loaded(provider: string, env: Record<string, string>, id = 'cnx') {
    return { id, config: { ...config, provider }, env } as any
}

async function onDisk(id: string, json: unknown, env?: string) {
    await mkdir(connectionDir(id), { recursive: true })
    await writeFile(connectionConfigPath(id), JSON.stringify(json))
    if (env !== undefined) await writeFile(connectionEnvPath(id), env)
}

beforeEach(async () => {
    await rm(connectionsDir(), { recursive: true, force: true })
})

describe('isConnected', () => {
    it('looks for the credential each provider stores its token under', () => {
        expect(isConnected(loaded('anthropic', { ANTHROPIC_API_KEY: 'k' }))).toBe(true)
        expect(isConnected(loaded('claude', { CLAUDE_CODE_OAUTH_TOKEN: 'k' }))).toBe(true)
        expect(isConnected(loaded('codex', { CODEX_OAUTH_TOKEN: 'k' }))).toBe(true)
        expect(isConnected(loaded('openai', { OPENAI_API_KEY: 'k' }))).toBe(true)
        expect(isConnected(loaded('google', { GOOGLE_GENERATIVE_AI_API_KEY: 'k' }))).toBe(true)
        expect(isConnected(loaded('openrouter', { OPENROUTER_API_KEY: 'k' }))).toBe(true)
    })

    it('does not count a satellite, another provider key or an empty value', () => {
        expect(isConnected(loaded('claude', { CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'r' }))).toBe(false)
        expect(isConnected(loaded('google', { GOOGLE_API_KEY: 'k' }))).toBe(false)
        expect(isConnected(loaded('openai', { ANTHROPIC_API_KEY: 'k' }))).toBe(false)
        expect(isConnected(loaded('anthropic', { ANTHROPIC_API_KEY: '' }))).toBe(false)
    })

    it('never counts a rerun-provider connection under another id, which has no key to hold', () => {
        expect(isConnected(loaded('rerun', { RERUN_API_KEY: 'k' }, 'other'))).toBe(false)
    })
})

describe('toSummary', () => {
    it('carries the config and the verdict, never the credential', () => {
        const summary = toSummary(loaded('anthropic', { ANTHROPIC_API_KEY: 'sk-secret' }))
        expect(summary).toEqual({ id: 'cnx', ...config, connected: true, credentialRejected: false, planLimits: null, cliModels: null, providerModels: null })
        expect(JSON.stringify(summary)).not.toContain('sk-secret')
        expect(summary).not.toHaveProperty('env')
    })

    it('says when the provider turned the credential away, while it still reads as connected', async () => {
        recordCredentialRejected('cnx-rejected')
        expect(toSummary(loaded('claude', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-dead' }, 'cnx-rejected'))).toMatchObject({ connected: true, credentialRejected: true })
    })
})

describe('reading from disk', () => {
    it('loads the config and the .env of a connection', async () => {
        await onDisk('cnx1', config, 'ANTHROPIC_API_KEY=sk-1\n')
        expect(connectionExists('cnx1')).toBe(true)
        expect(await loadConnectionFromDisk('cnx1')).toEqual({ id: 'cnx1', config: { ...config }, env: { ANTHROPIC_API_KEY: 'sk-1' } })
    })

    it('loads a connection with no .env as an empty env and fills the config defaults', async () => {
        await onDisk('cnx2', { name: 'Bare', provider: 'openai', createdAt: 'x' })
        expect(await loadConnectionFromDisk('cnx2')).toEqual({ id: 'cnx2', config: { name: 'Bare', provider: 'openai', models: [], extraModels: [], createdAt: 'x' }, env: {} })
    })

    it('refuses a config.json that does not parse', async () => {
        await onDisk('broken', { name: '', provider: 'nope' })
        await expect(loadConnectionFromDisk('broken')).rejects.toThrow()
    })

    it('lists only the folders holding a connection.json', async () => {
        expect(await listConnectionIds()).toEqual([])
        await onDisk('cnx1', config)
        await onDisk('cnx2', config)
        await mkdir(connectionDir('empty'), { recursive: true })
        await writeFile(boxDefaultPath(), '{}')
        await writeFile(connectionsMigratedPath(), '')
        expect((await listConnectionIds()).sort()).toEqual(['cnx1', 'cnx2'])
        expect(connectionExists('empty')).toBe(false)
    })

    it('refuses an id that is not a single path segment', () => {
        expect(() => connectionExists('../agents')).toThrow(expect.objectContaining({ status: 400 }))
    })
})
