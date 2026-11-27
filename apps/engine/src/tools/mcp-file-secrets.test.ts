import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-file-secrets-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const { describe, expect, it } = await import('vitest')
const { existsSync } = await import('node:fs')
const { readdir, readFile, stat } = await import('node:fs/promises')
const { agentMcpCredentialsDir } = await import('../config/paths.js')
const { materializeFileSecrets, pruneCredentialFiles } = await import('./mcp-file-secrets.js')
const { prepareMcpServer } = await import('./mcp.js')
const SERVICE_ACCOUNT = '{"type":"service_account","project_id":"demo","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"}'

const firebase = (env: Record<string, string> = { GOOGLE_APPLICATION_CREDENTIALS: '${file:FIREBASE_SA}' }) => ({
    name: 'firebase',
    command: 'npx',
    args: ['-y', 'firebase-tools@latest', 'mcp'],
    env,
    headers: {},
})

const mode = async (path: string) => (await stat(path)).mode & 0o777

describe('materializeFileSecrets', () => {
    it('hands the server the path of a file holding the value, readable by the engine only', async () => {
        const dir = agentMcpCredentialsDir('agent-1')
        const prepared = await materializeFileSecrets(firebase(), { FIREBASE_SA: SERVICE_ACCOUNT }, dir)
        const path = prepared.env.GOOGLE_APPLICATION_CREDENTIALS
        expect(path.startsWith(`${dir}/FIREBASE_SA-`)).toBe(true)
        expect(await readFile(path, 'utf8')).toBe(SERVICE_ACCOUNT)
        expect(await mode(path)).toBe(0o600)
        expect(await mode(dir)).toBe(0o700)
        expect(JSON.stringify(prepared)).not.toContain('service_account')
    })

    it('writes a new value to a new path and drops the old file, so the pool dials the server again', async () => {
        const dir = agentMcpCredentialsDir('agent-rotate')
        const first = (await materializeFileSecrets(firebase(), { FIREBASE_SA: SERVICE_ACCOUNT }, dir)).env.GOOGLE_APPLICATION_CREDENTIALS
        const again = (await materializeFileSecrets(firebase(), { FIREBASE_SA: SERVICE_ACCOUNT }, dir)).env.GOOGLE_APPLICATION_CREDENTIALS
        const rotated = (await materializeFileSecrets(firebase(), { FIREBASE_SA: '{"type":"service_account","project_id":"other"}' }, dir)).env.GOOGLE_APPLICATION_CREDENTIALS
        expect(again).toBe(first)
        expect(rotated).not.toBe(first)
        expect(existsSync(first)).toBe(false)
        expect(await readdir(dir)).toHaveLength(1)
    })

    it('keeps each variable to its own file, a name prefixing another one included', async () => {
        const dir = agentMcpCredentialsDir('agent-two')
        const prepared = await materializeFileSecrets(firebase({ A: '${file:KEY}', B: '${file:KEY_B}' }), { KEY: '{"a":1}', KEY_B: '{"b":2}' }, dir)
        expect(await readFile(prepared.env.A, 'utf8')).toBe('{"a":1}')
        expect(await readFile(prepared.env.B, 'utf8')).toBe('{"b":2}')
    })

    it('leaves an empty value and writes nothing for a variable the coworker does not hold', async () => {
        const dir = agentMcpCredentialsDir('agent-missing')
        const prepared = await materializeFileSecrets(firebase(), {}, dir)
        expect(prepared.env.GOOGLE_APPLICATION_CREDENTIALS).toBe('')
        expect(existsSync(dir)).toBe(false)
    })

    it('touches neither the disk nor the plain ${VAR}s of a server without a file placeholder', async () => {
        const server = firebase({ TOKEN: '${TOKEN}' })
        expect(await materializeFileSecrets(server, { TOKEN: 'x' }, agentMcpCredentialsDir('agent-plain'))).toBe(server)
        expect(existsSync(agentMcpCredentialsDir('agent-plain'))).toBe(false)
    })
})

describe('pruneCredentialFiles', () => {
    it('drops the file of a variable removed or changed, and keeps the one still held', async () => {
        const dir = agentMcpCredentialsDir('agent-prune')
        const kept = (await materializeFileSecrets(firebase({ A: '${file:KEEP}', B: '${file:GONE}', C: '${file:ROTATED}' }), { KEEP: '{"k":1}', GONE: '{"g":1}', ROTATED: '{"r":1}' }, dir)).env
        await pruneCredentialFiles(dir, { KEEP: '{"k":1}', ROTATED: '{"r":2}' })
        expect(existsSync(kept.A)).toBe(true)
        expect(existsSync(kept.B)).toBe(false)
        expect(existsSync(kept.C)).toBe(false)
        expect(await readdir(dir)).toHaveLength(1)
    })

    it('does nothing for a folder never written', async () => {
        await expect(pruneCredentialFiles(agentMcpCredentialsDir('agent-none'), {})).resolves.toBeUndefined()
    })
})

describe('prepareMcpServer with a ${file:VAR}', () => {
    it("writes the coworker's own variable to its folder of credentials, out of its workspace", async () => {
        const prepared = await prepareMcpServer('agent-prepare', firebase({ GOOGLE_APPLICATION_CREDENTIALS: '${file:FIREBASE_SA}', PROJECT: '${PROJECT}' }), { FIREBASE_SA: SERVICE_ACCOUNT, PROJECT: 'demo' })
        expect(prepared.env.GOOGLE_APPLICATION_CREDENTIALS.startsWith(agentMcpCredentialsDir('agent-prepare'))).toBe(true)
        expect(prepared.env.PROJECT).toBe('demo')
        expect(await readFile(prepared.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).toBe(SERVICE_ACCOUNT)
    })
})