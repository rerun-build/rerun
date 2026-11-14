import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { McpServer } from '@rerun/contracts'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-im-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { ARCHIVE_LIMITS, buildArchive } = await import('./archive.js')
const { importAgent } = await import('./import.js')
const { agentConfigSchema } = await import('./types.js')
const { loadAgentFromDisk } = await import('./loader.js')
const { RERUN_MODEL } = await import('@rerun/contracts')
const { listAgentIndex } = await import('../db/repos/agents.js')
const { migrate } = await import('../db/migrate.js')
const { createReadStream } = await import('node:fs')
const { mkdir, readFile, stat, symlink, writeFile } = await import('node:fs/promises')
const { randomBytes } = await import('node:crypto')
const { Readable } = await import('node:stream')
const { pipeline } = await import('node:stream/promises')
const { createWriteStream } = await import('node:fs')
const { agentDir, workspaceDir } = await import('../config/paths.js')
const { create } = await import('tar')

const SOURCE_ID = 'importsource'
const SOURCE_TRIGGER_TOKEN = 'tok-source-webhook-secret'
const SOURCE_CONNECTION_ID = 'cnxsource'
const SOURCE_MODEL = 'claude-opus-4-8'

const srv = (name: string, env: Record<string, string>, headers: Record<string, string> = {}): McpServer => ({
    name,
    transport: 'http',
    url: `http://${name}`,
    args: [],
    env,
    headers,
})

const config = agentConfigSchema.parse({
    name: 'source',
    displayName: 'Source',
    description: 'An agent to copy',
    connectionId: SOURCE_CONNECTION_ID,
    provider: 'anthropic',
    model: SOURCE_MODEL,
    setup: { required: true, completedAt: '2026-01-01T00:00:00.000Z', sessionId: 'author-install' },
    mcpServers: [srv('fal', { FAL_KEY: '${RERUN_SVC_FAL_FAL_KEY}' }, { 'x-rerun-agent': SOURCE_ID })],
})

function bodyOf(path: string): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
}

async function tarballOf(files: Record<string, string>): Promise<string> {
    const scratch = mkdtempSync(resolve(tmpdir(), 'rerun-imt-'))
    const staging = resolve(scratch, 'payload')
    for (const [path, content] of Object.entries(files)) {
        const target = resolve(staging, path)
        await mkdir(resolve(target, '..'), { recursive: true })
        await writeFile(target, content)
    }
    const tarball = resolve(scratch, 'archive.tar.gz')
    await create({ gzip: true, cwd: staging, file: tarball }, ['.'])
    return tarball
}

async function archiveOfSource(): Promise<string> {
    const { stream } = await buildArchive(SOURCE_ID)
    const path = resolve(mkdtempSync(resolve(tmpdir(), 'rerun-imf-')), 'source.tar.gz')
    await pipeline(stream, createWriteStream(path))
    return path
}

beforeAll(async () => {
    await migrate()
    const root = agentDir(SOURCE_ID)
    await mkdir(resolve(root, 'workspace/.rerun'), { recursive: true })
    await mkdir(resolve(root, 'skills/research'), { recursive: true })
    await mkdir(resolve(root, 'schedules'), { recursive: true })
    await mkdir(resolve(root, 'triggers'), { recursive: true })
    await mkdir(resolve(root, 'mcp'), { recursive: true })
    await mkdir(resolve(root, 'memory'), { recursive: true })

    await writeFile(resolve(root, 'config.json'), JSON.stringify(config, null, 2))
    await writeFile(resolve(root, 'SOUL.md'), 'You are the source agent.')
    await writeFile(resolve(root, 'INSTALL.md'), 'Connect the fal connector, then generate one test image.')
    await writeFile(resolve(root, '.env'), 'RERUN_SVC_FAL_FAL_KEY=fal-AAAAAAAAAAAAAAAAAAAA\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-CCCCCCCCCCCCCCCCCCCCCC\n')
    await writeFile(resolve(root, 'mcp/fal.json'), JSON.stringify({ accessToken: 'secret-token' }))
    await writeFile(resolve(root, 'skills/research/SKILL.md'), '---\nname: Research\ndescription: Looks things up\n---\n\nDo research.')
    await writeFile(resolve(root, 'schedules/daily.md'), `---\nname: Daily\ncron: 0 9 * * *\nenabled: true\nconnection: ${SOURCE_CONNECTION_ID}\nprovider: anthropic\nmodel: ${SOURCE_MODEL}\n---\n\nReport.`)
    await writeFile(resolve(root, 'schedules/onboard.md'), `---\nname: Onboard\nenabled: true\nconnection: ${SOURCE_CONNECTION_ID}\nprovider: anthropic\nmodel: ${SOURCE_MODEL}\n---\n\nWalk them through it.`)
    await writeFile(resolve(root, 'triggers/inbound.md'), `---\nname: Inbound\nenabled: true\ntoken: ${SOURCE_TRIGGER_TOKEN}\nmethods:\n  - POST\nconnection: ${SOURCE_CONNECTION_ID}\nprovider: anthropic\nmodel: ${SOURCE_MODEL}\ncreatedAt: '2026-01-01T00:00:00.000Z'\n---\n\nA Stripe refund event arrives, record it.`)
    await writeFile(resolve(root, 'workspace/brief.md'), 'A reference brief.')
    await writeFile(resolve(root, 'memory/mem1.md'), '---\nid: mem1\nkind: note\ntags: []\ncreatedAt: 2026-01-01T00:00:00.000Z\n---\n\nThe client prefers short answers.')
    await writeFile(
        resolve(root, 'workspace/.rerun/services.json'),
        JSON.stringify({
            services: {
                fal: { status: 'active', envKeys: ['RERUN_SVC_FAL_FAL_KEY'], mcpServers: ['fal'] },
                gmail: { status: 'active', mcpServers: ['gmail'], composio: { serverName: 'gmail' } },
                'gmail@k3x9ab': { status: 'active', instanceId: 'k3x9ab', label: 'support@acme.com', mcpServers: ['gmail-k3x9ab'], composio: { serverName: 'gmail-k3x9ab', accountLabel: 'support@acme.com' } },
            },
        }),
    )
})

describe('importAgent', () => {
    it('restores the folder under a new id and a new handle', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_2', displayName: 'Source copy' })

        expect(result.id).not.toBe(SOURCE_ID)
        expect(result.name).toBe('source_2')
        expect(result.displayName).toBe('Source copy')
        expect(result.soul).toBe('You are the source agent.')
        expect(await readFile(resolve(agentDir(result.id), 'skills/research/SKILL.md'), 'utf8')).toContain('Do research.')
        expect(await readFile(resolve(agentDir(result.id), 'schedules/daily.md'), 'utf8')).toContain('cron: 0 9 * * *')
        expect(await readFile(resolve(agentDir(result.id), 'workspace/brief.md'), 'utf8')).toBe('A reference brief.')
        expect((await listAgentIndex()).some(row => row.id === result.id && row.name === 'source_2')).toBe(true)
    })

    it('rebinds the agent id the capture turned into a token', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_3' })
        const imported = agentConfigSchema.parse(JSON.parse(await readFile(resolve(agentDir(result.id), 'config.json'), 'utf8')))

        expect(imported.mcpServers[0].headers['x-rerun-agent']).toBe(result.id)
        expect(imported.mcpServers[0].env.FAL_KEY).toBe('${RERUN_SVC_FAL_FAL_KEY}')
    })

    it('carries the setup instructions and hands the copy a pending install', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_setup' })
        const imported = agentConfigSchema.parse(JSON.parse(await readFile(resolve(agentDir(result.id), 'config.json'), 'utf8')))

        expect(await readFile(resolve(agentDir(result.id), 'INSTALL.md'), 'utf8')).toContain('Connect the fal connector')
        expect(imported.setup.required).toBe(true)
        expect(imported.setup.completedAt).toBeNull()
        expect(imported.setup.sessionId).toBeNull()
    })

    it('keeps the env key names, no value, and the 0600 a fresh agent gets', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_4' })

        expect(await readFile(resolve(agentDir(result.id), '.env'), 'utf8')).toBe('RERUN_SVC_FAL_FAL_KEY=')
        expect(result.envKeys).toEqual(['RERUN_SVC_FAL_FAL_KEY'])
        expect((await stat(resolve(agentDir(result.id), '.env'))).mode & 0o777).toBe(0o600)
    })

    it('drops the pair the template was captured on', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_pair' })
        const config = JSON.parse(await readFile(resolve(agentDir(result.id), 'config.json'), 'utf8'))

        expect(config).toMatchObject({ connectionId: null, provider: null, model: null })
        expect((await loadAgentFromDisk(result.id)).resolved).toMatchObject({ provider: 'rerun', model: RERUN_MODEL })
    })

    it('drops a pair the archive planted rather than trusting it', async () => {
        const pinned = agentConfigSchema.parse({ name: 'pinned', connectionId: 'cnxplanted', provider: 'openai', model: 'gpt-5.4', setup: { required: false, completedAt: null } })
        const tarball = await tarballOf({ 'config.json': JSON.stringify(pinned), 'SOUL.md': 'Ready to run.' })

        const result = await importAgent({ body: bodyOf(tarball), name: 'source_planted_pair' })
        const config = JSON.parse(await readFile(resolve(agentDir(result.id), 'config.json'), 'utf8'))

        expect(config).toMatchObject({ connectionId: null, provider: null, model: null })
    })

    it('drops the step limit and temperature an older template still carries', async () => {
        const legacy = { ...agentConfigSchema.parse({ name: 'legacy', setup: { required: false, completedAt: null } }), stepLimit: 40, temperature: 0.4 }
        const tarball = await tarballOf({ 'config.json': JSON.stringify(legacy), 'SOUL.md': 'Ready to run.' })

        const result = await importAgent({ body: bodyOf(tarball), name: 'source_step_limit' })
        const config = JSON.parse(await readFile(resolve(agentDir(result.id), 'config.json'), 'utf8'))

        expect(config).not.toHaveProperty('stepLimit')
        expect(config).not.toHaveProperty('temperature')
    })

    it('drops the pair its schedules and triggers carried', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_autopair' })

        for (const path of ['schedules/daily.md', 'schedules/onboard.md', 'triggers/inbound.md']) {
            const raw = await readFile(resolve(agentDir(result.id), path), 'utf8')
            expect(raw).not.toContain(SOURCE_CONNECTION_ID)
            expect(raw).not.toContain(SOURCE_MODEL)
            expect(raw).toContain('connection: null')
            expect(raw).toContain('provider: null')
            expect(raw).toContain('model: null')
        }
    })

    it('makes the imported memories recallable again', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_5' })
        expect(result.memoriesIndexed).toBe(1)
    })

    it('reports the connectors the copy still has to authorize', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_6' })
        expect(result.connectorSlugs).toEqual(['fal', 'gmail'])
        expect(result.mcpAuth).toEqual([{ server: 'fal', kind: 'unknown' }])
    })

    it('keeps every account of an app apart in the copy, without the labels naming them', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_6b' })
        const registry = JSON.parse(await readFile(resolve(workspaceDir(result.id), '.rerun/services.json'), 'utf8'))
        expect(Object.keys(registry.services).sort()).toEqual(['fal', 'gmail', 'gmail@k3x9ab'])
        expect(registry.services['gmail@k3x9ab']).toEqual({ status: 'active', instanceId: 'k3x9ab', mcpServers: ['gmail-k3x9ab'], composio: { serverName: 'gmail-k3x9ab' } })
    })

    it('moves the imported schedules to their next genuine slot', async () => {
        const result = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_7' })
        const daily = await readFile(resolve(agentDir(result.id), 'schedules/daily.md'), 'utf8')

        expect(daily).toContain('enabled: true')
        expect(daily).toMatch(/lastRunAt: '?20\d\d-/)
    })

    it('switches on the captured schedules of an agent that needs no setup', async () => {
        const noSetup = agentConfigSchema.parse({ name: 'nosetup', setup: { required: false, completedAt: null } })
        const tarball = await tarballOf({ 'config.json': JSON.stringify(noSetup), 'SOUL.md': 'Ready to run.', 'schedules/daily.md': '---\nname: Daily\ncron: 0 9 * * *\nenabled: false\n---\n\nReport.' })

        const result = await importAgent({ body: bodyOf(tarball), name: 'source_ready' })

        expect(await readFile(resolve(agentDir(result.id), 'schedules/daily.md'), 'utf8')).toContain('enabled: true')
    })

    it('issues every imported webhook a token of its own', async () => {
        const first = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_8' })
        const second = await importAgent({ body: bodyOf(await archiveOfSource()), name: 'source_9' })

        const read = async (id: string) => await readFile(resolve(agentDir(id), 'triggers/inbound.md'), 'utf8')
        const tokenOf = (raw: string) => raw.match(/token: '?([^'\n]+)'?/)?.[1] ?? ''

        expect(first.triggers).toEqual(['inbound'])
        for (const id of [first.id, second.id]) {
            const raw = await read(id)
            expect(raw).not.toContain(SOURCE_TRIGGER_TOKEN)
            expect(tokenOf(raw)).toHaveLength(21)
            expect(raw).toContain('A Stripe refund event arrives, record it.')
        }
        expect(tokenOf(await read(first.id))).not.toBe(tokenOf(await read(second.id)))
    })

    it('reissues a token even when the archive shipped one', async () => {
        const noSetup = agentConfigSchema.parse({ name: 'nosetup', setup: { required: false, completedAt: null } })
        const tarball = await tarballOf({
            'config.json': JSON.stringify(noSetup),
            'SOUL.md': 'Ready to run.',
            'triggers/inbound.md': "---\nname: Inbound\nenabled: false\ntoken: planted-token\nmethods:\n  - POST\ncreatedAt: '2026-01-01T00:00:00.000Z'\n---\n\nDo the thing.",
        })

        const result = await importAgent({ body: bodyOf(tarball), name: 'source_planted' })
        const raw = await readFile(resolve(agentDir(result.id), 'triggers/inbound.md'), 'utf8')

        expect(raw).not.toContain('planted-token')
        expect(raw).toContain('enabled: true')
    })

    it('leaves them off while an install is still pending', async () => {
        const tarball = await tarballOf({
            'config.json': JSON.stringify(config),
            'SOUL.md': 'Not ready.',
            'INSTALL.md': 'Connect the fal connector.',
            'schedules/daily.md': '---\nname: Daily\ncron: 0 9 * * *\nenabled: false\n---\n\nReport.',
            'triggers/inbound.md': "---\nname: Inbound\nenabled: false\ntoken: ''\nmethods:\n  - POST\ncreatedAt: '2026-01-01T00:00:00.000Z'\n---\n\nDo the thing.",
        })

        const result = await importAgent({ body: bodyOf(tarball), name: 'source_pending' })

        expect(await readFile(resolve(agentDir(result.id), 'schedules/daily.md'), 'utf8')).toContain('enabled: false')
        expect(await readFile(resolve(agentDir(result.id), 'triggers/inbound.md'), 'utf8')).toContain('enabled: false')
    })

    it('answers 400 rather than dying when the archive unpacks past the ceiling', async () => {
        const scratch = mkdtempSync(resolve(tmpdir(), 'rerun-imz-'))
        const staging = resolve(scratch, 'payload')
        await mkdir(resolve(staging, 'workspace'), { recursive: true })
        await writeFile(resolve(staging, 'config.json'), JSON.stringify(config))
        const fat = randomBytes(22 * 1024 * 1024).map(byte => byte & 0x03)
        const files = Math.floor(ARCHIVE_LIMITS.maxTotalBytes / fat.length) + 1
        for (let i = 0; i < files; i++) await writeFile(resolve(staging, `workspace/fat${i}.bin`), fat)
        const tarball = resolve(scratch, 'fat.tar.gz')
        await create({ gzip: { level: 1 }, cwd: staging, file: tarball }, ['.'])

        await expect(importAgent({ body: bodyOf(tarball), name: 'fat' })).rejects.toThrow(/unpacks to more than/)
    }, 30_000)

    it('refuses a directory planted where a file root belongs', async () => {
        const scratch = mkdtempSync(resolve(tmpdir(), 'rerun-imd-'))
        const staging = resolve(scratch, 'payload')
        await mkdir(resolve(staging, 'data/agent.db'), { recursive: true })
        await mkdir(resolve(staging, '.env'), { recursive: true })
        await writeFile(resolve(staging, 'config.json'), JSON.stringify(config))
        await writeFile(resolve(staging, 'data/agent.db/planted'), 'not a database')
        await writeFile(resolve(staging, '.env/planted'), 'not an env file')
        const tarball = resolve(scratch, 'planted.tar.gz')
        await create({ gzip: true, cwd: staging, file: tarball }, ['.'])

        const result = await importAgent({ body: bodyOf(tarball), name: 'planted' })
        await expect(stat(resolve(agentDir(result.id), 'data/agent.db/planted'))).rejects.toThrow()
        await expect(stat(resolve(agentDir(result.id), '.env/planted'))).rejects.toThrow()
        expect((await stat(resolve(agentDir(result.id), '.env'))).isFile()).toBe(true)
    })

    it('refuses an archive that is not an agent folder', async () => {
        const staging = mkdtempSync(resolve(tmpdir(), 'rerun-imx-'))
        await writeFile(resolve(staging, 'SOUL.md'), 'no config here')
        const tarball = resolve(staging, '..', 'nonagent.tar.gz')
        await create({ gzip: true, cwd: staging, file: tarball }, ['.'])

        await expect(importAgent({ body: bodyOf(tarball), name: 'nope' })).rejects.toThrow(/not an agent folder/)
    })

    it('drops a link, an unlisted root and a path that climbs out', async () => {
        const scratch = mkdtempSync(resolve(tmpdir(), 'rerun-imh-'))
        const staging = resolve(scratch, 'payload')
        await mkdir(resolve(staging, 'mcp'), { recursive: true })
        await mkdir(resolve(staging, 'data'), { recursive: true })
        await writeFile(resolve(staging, 'config.json'), JSON.stringify(config))
        await writeFile(resolve(staging, 'SOUL.md'), 'hostile')
        await writeFile(resolve(staging, 'mcp/fal.json'), JSON.stringify({ accessToken: 'stolen' }))
        await writeFile(resolve(staging, 'data/system.db'), 'someone else transcripts')
        await writeFile(resolve(scratch, 'escape.txt'), 'pwned')
        await symlink('/etc/passwd', resolve(staging, 'passwd-link'))

        const tarball = resolve(scratch, 'hostile.tar.gz')
        await create({ gzip: true, cwd: staging, file: tarball, preservePaths: true }, ['.', '../escape.txt'])

        const result = await importAgent({ body: bodyOf(tarball), name: 'hostile' })
        const root = agentDir(result.id)

        expect(result.skippedPaths).toEqual(expect.arrayContaining(['mcp/fal.json', 'data/system.db', 'passwd-link', '../escape.txt']))
        await expect(stat(resolve(root, 'mcp/fal.json'))).rejects.toThrow()
        await expect(stat(resolve(root, 'data/system.db'))).rejects.toThrow()
        await expect(stat(resolve(root, 'passwd-link'))).rejects.toThrow()
        await expect(stat(resolve(root, '..', 'escape.txt'))).rejects.toThrow()
    })
})
