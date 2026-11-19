import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cx-store-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it } = await import('vitest')
const { readFile, rm, stat } = await import('node:fs/promises')
const { DEFAULT_CONNECTION_MODELS, RERUN_CONNECTION_ID, RERUN_MODEL } = await import('@moldwright/contracts')
const { connectionConfigPath, connectionDir, connectionEnvPath, connectionsDir } = await import('../config/paths.js')
const { readEnvFile } = await import('../lib/env-file.js')
const { getConnection, listConnections, unloadConnection } = await import('./registry.js')
const { createConnection, deleteConnection, ensureMoldwrightConnection, patchConnection, updateConnectionKeys } = await import('./store.js')
const { isCredentialRejected, recordCredentialRejected } = await import('./credential-rejections.js')

beforeEach(async () => {
    unloadConnection(RERUN_CONNECTION_ID)
    await rm(connectionsDir(), { recursive: true, force: true })
})

async function claude(keys: Record<string, string>) {
    return createConnection({ name: 'Claude', provider: 'claude', models: ['opus'], extraModels: [], keys })
}

describe('updateConnectionKeys', () => {
    it('removes first, then sets, and answers the sorted key names', async () => {
        const cnx = await claude({ ZETA: 'z', CLAUDE_CODE_OAUTH_TOKEN: 'old', DROPPED: 'd' })

        const keys = await updateConnectionKeys(cnx.id, { set: { CLAUDE_CODE_OAUTH_TOKEN: 'new', ALPHA: 'a' }, remove: ['CLAUDE_CODE_OAUTH_TOKEN', 'DROPPED', 'NEVER_THERE'] })

        expect(keys).toEqual(['ALPHA', 'CLAUDE_CODE_OAUTH_TOKEN', 'ZETA'])
        expect(await readEnvFile(connectionEnvPath(cnx.id))).toEqual({ ZETA: 'z', CLAUDE_CODE_OAUTH_TOKEN: 'new', ALPHA: 'a' })
        expect((await getConnection(cnx.id)).env.CLAUDE_CODE_OAUTH_TOKEN).toBe('new')
    })

    it('keeps the .env readable by its owner only', async () => {
        const cnx = await claude({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' })
        expect((await stat(connectionEnvPath(cnx.id))).mode & 0o777).toBe(0o600)
        await updateConnectionKeys(cnx.id, { set: { OTHER: 'x' }, remove: [] })
        expect((await stat(connectionEnvPath(cnx.id))).mode & 0o777).toBe(0o600)
    })

    it('refuses a value holding a line break and leaves the file as it was', async () => {
        const cnx = await claude({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' })
        const before = await readFile(connectionEnvPath(cnx.id), 'utf8')

        await expect(updateConnectionKeys(cnx.id, { set: { CLAUDE_CODE_OAUTH_TOKEN: 'a\nINJECTED=1' }, remove: [] })).rejects.toMatchObject({ status: 400 })

        expect(await readFile(connectionEnvPath(cnx.id), 'utf8')).toBe(before)
        expect((await getConnection(cnx.id)).env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' })
    })

    it('clears a rejection, since the new keys are another sign-in', async () => {
        const cnx = await claude({ CLAUDE_CODE_OAUTH_TOKEN: 'dead' })
        recordCredentialRejected(cnx.id)
        await updateConnectionKeys(cnx.id, { set: { CLAUDE_CODE_OAUTH_TOKEN: 'fresh' }, remove: [] })
        expect(isCredentialRejected(cnx.id)).toBe(false)
    })

    it('refuses the keyless Rerun connection', async () => {
        await ensureMoldwrightConnection()
        await expect(updateConnectionKeys(RERUN_CONNECTION_ID, { set: { X: 'y' }, remove: [] })).rejects.toMatchObject({ status: 400, message: 'The Rerun connection is keyless' })
    })
})

describe('the Rerun connection', () => {
    it('is provisioned once, keyless, and cannot be renamed, stripped of Rerun Balanced or deleted', async () => {
        await ensureMoldwrightConnection()
        await ensureMoldwrightConnection()
        const rerun = await getConnection(RERUN_CONNECTION_ID)
        expect(rerun.config.provider).toBe('rerun')
        expect(rerun.env).toEqual({})

        await expect(patchConnection(RERUN_CONNECTION_ID, { name: 'Mine' })).rejects.toMatchObject({ status: 400 })
        await expect(patchConnection(RERUN_CONNECTION_ID, { models: [] })).rejects.toMatchObject({ status: 400 })
        await expect(deleteConnection(RERUN_CONNECTION_ID)).rejects.toMatchObject({ status: 400 })
        expect(existsSync(connectionDir(RERUN_CONNECTION_ID))).toBe(true)
        expect((await patchConnection(RERUN_CONNECTION_ID, { models: [RERUN_MODEL] })).config.models).toEqual([RERUN_MODEL])
    })

    it('gains the tiers that came after it at boot, once, behind the model it already had', async () => {
        await ensureMoldwrightConnection()
        await patchConnection(RERUN_CONNECTION_ID, { models: [RERUN_MODEL] })

        await ensureMoldwrightConnection()
        await ensureMoldwrightConnection()

        expect((await getConnection(RERUN_CONNECTION_ID)).config.models).toEqual(['rerun-max', 'rerun-fast', 'rerun-smart'])
        expect(DEFAULT_CONNECTION_MODELS.rerun[0]).toBe(RERUN_MODEL)
    })
})

describe('createConnection', () => {
    it('refuses a key holding a line break before anything reaches the disk', async () => {
        await expect(claude({ CLAUDE_CODE_OAUTH_TOKEN: 'a\nINJECTED=1' })).rejects.toMatchObject({ status: 400 })
        expect(await listConnections()).toEqual([])
        expect(existsSync(connectionsDir())).toBe(false)
    })
})

describe('patch and delete', () => {
    it('merges a patch over the stored config and keeps the credential', async () => {
        const cnx = await createConnection({ name: 'Router', provider: 'openrouter', models: ['a'], extraModels: [], keys: { OPENROUTER_API_KEY: 'k' } })
        const patched = await patchConnection(cnx.id, { baseUrl: 'https://router.example.com/api', extraModels: ['x/y'] })
        expect(patched.config).toMatchObject({ name: 'Router', provider: 'openrouter', models: ['a'], baseUrl: 'https://router.example.com/api', extraModels: ['x/y'] })
        expect(JSON.parse(await readFile(connectionConfigPath(cnx.id), 'utf8'))).toEqual(patched.config)
        expect(patched.env).toEqual({ OPENROUTER_API_KEY: 'k' })
    })

    it('deletes the folder and forgets the cached instance', async () => {
        const cnx = await claude({ CLAUDE_CODE_OAUTH_TOKEN: 't' })
        recordCredentialRejected(cnx.id)
        await deleteConnection(cnx.id)
        expect(existsSync(connectionDir(cnx.id))).toBe(false)
        expect(isCredentialRejected(cnx.id)).toBe(false)
        await expect(getConnection(cnx.id)).rejects.toMatchObject({ status: 404 })
    })
})

describe('a custom connection', () => {
    it('needs an address to be created, and keeps it', async () => {
        await expect(createConnection({ name: 'Ollama', provider: 'custom', models: ['qwen3:4b'], extraModels: [], keys: {} })).rejects.toThrow('A custom connection needs a base URL')
        const cnx = await createConnection({ name: 'Ollama', provider: 'custom', models: ['qwen3:4b'], baseUrl: 'http://localhost:11434/v1', extraModels: [], contextWindow: 32_768, vision: false, keys: {} })
        expect(cnx.config).toMatchObject({ provider: 'custom', baseUrl: 'http://localhost:11434/v1', contextWindow: 32_768, vision: false })
        await expect(patchConnection(cnx.id, { baseUrl: '' })).rejects.toThrow('A custom connection needs a base URL')
    })

    it('clears its context window with null', async () => {
        const cnx = await createConnection({ name: 'vLLM', provider: 'custom', models: [], baseUrl: 'http://gpu.lan:8000/v1', extraModels: [], contextWindow: 65_536, keys: {} })
        expect((await patchConnection(cnx.id, { contextWindow: null })).config.contextWindow).toBeNull()
    })
})
