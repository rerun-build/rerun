import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { McpServer } from '@rerun/contracts'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-ar-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { buildArchive, listArchivablePaths, planArchive, scrubConfig } = await import('./archive.js')
const { agentConfigSchema } = await import('./types.js')
const { mkdir, readFile, writeFile } = await import('node:fs/promises')
const { agentDir } = await import('../config/paths.js')
const { list } = await import('tar')

const AGENT_ID = 'archiveagent'
const TRIGGER_TOKEN = 'tok-live-webhook-secret'

const srv = (name: string, env: Record<string, string>, headers: Record<string, string> = {}): McpServer => ({
    name,
    transport: 'http',
    url: `http://${name}`,
    args: [],
    env,
    headers,
})

const config = agentConfigSchema.parse({
    name: 'archived',
    displayName: 'Archived',
    description: 'An agent to capture',
    setup: { required: true, completedAt: '2026-01-01T00:00:00.000Z' },
    mcpServers: [
        srv('stripe', { STRIPE_KEY: 'sk_live_AAAAAAAAAAAAAAAAAAAAAAAA' }, { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz0123' }),
        // The two shapes the UI compiler emits: a reference embedded in a larger string, and the
        // source agent id carried in a header for the managed proxy.
        srv('fal', { FAL_KEY: '${RERUN_SVC_FAL_FAL_KEY}' }, { Authorization: 'Bearer ${RERUN_SVC_FAL_FAL_KEY}', 'x-rerun-agent': AGENT_ID }),
    ],
})

beforeAll(async () => {
    const root = agentDir(AGENT_ID)
    await mkdir(resolve(root, 'workspace/.rerun'), { recursive: true })
    await mkdir(resolve(root, 'workspace/.secrets'), { recursive: true })
    await mkdir(resolve(root, 'workspace/node_modules/left-pad'), { recursive: true })
    await mkdir(resolve(root, 'workspace/scripts/__pycache__'), { recursive: true })
    await mkdir(resolve(root, 'skills/research'), { recursive: true })
    await mkdir(resolve(root, 'schedules'), { recursive: true })
    await mkdir(resolve(root, 'triggers'), { recursive: true })
    await mkdir(resolve(root, 'mcp'), { recursive: true })
    await mkdir(resolve(root, 'data'), { recursive: true })
    await mkdir(resolve(root, 'memory/archive'), { recursive: true })
    await mkdir(resolve(root, 'workspace/.rerun/paid-data'), { recursive: true })
    await mkdir(resolve(root, 'workspace/.rerun/pages/acme.com'), { recursive: true })

    await writeFile(resolve(root, 'config.json'), JSON.stringify(config, null, 2))
    await writeFile(resolve(root, 'SOUL.md'), 'You are a research agent.')
    await writeFile(resolve(root, 'INSTALL.md'), 'Connect the Stripe connector, then confirm you can read a customer.')
    await writeFile(resolve(root, '.env'), 'RERUN_SVC_FAL_FAL_KEY=fal-AAAAAAAAAAAAAAAAAAAA\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-CCCCCCCCCCCCCCCCCCCCCC\nOPENCODE_API_KEY=oc_sk_DDDDDDDDDDDDDDDDDDDD\n')
    await writeFile(resolve(root, 'mcp/fal.json'), JSON.stringify({ accessToken: 'secret-token' }))
    await writeFile(resolve(root, 'mcp/fal.pending.json'), JSON.stringify({ startedAt: 0 }))
    await writeFile(resolve(root, 'data/agent.db'), 'the agent own tables')
    await writeFile(resolve(root, 'data/system.db'), 'binary transcripts')
    await writeFile(resolve(root, 'data/system.db-wal'), 'more transcripts')
    await writeFile(resolve(root, 'memory/mem1.md'), 'A learned memory about the client.')
    await writeFile(resolve(root, 'memory/archive/mem0.md'), 'A retired memory.')
    await writeFile(resolve(root, 'skills/research/SKILL.md'), '---\nname: Research\ndescription: Looks things up\n---\n\nDo research.')
    await writeFile(resolve(root, 'schedules/daily.md'), '---\nname: Daily\ncron: 0 9 * * *\n---\n\nReport.')
    await writeFile(
        resolve(root, 'triggers/inbound.md'),
        `---\nname: Inbound\ndescription: A refund arrived\nenabled: true\ntoken: ${TRIGGER_TOKEN}\nmethods:\n  - POST\nlastFiredAt: '2026-02-02T00:00:00.000Z'\nfireCount: 3\nprovider: anthropic\nmodel: claude-sonnet-4-6\ncreatedAt: '2026-01-01T00:00:00.000Z'\n---\n\nA Stripe refund event arrives, record it.`,
    )
    await writeFile(
        resolve(root, 'triggers/leaky.md'),
        '---\nname: Leaky\nenabled: true\ntoken: 0000000000000000\nmethods:\n  - POST\ncreatedAt: \'2026-01-01T00:00:00.000Z\'\n---\n\nCall the API with sk-ant-DDDDDDDDDDDDDDDDDDDDDD and report.',
    )
    await writeFile(resolve(root, 'workspace/brief.md'), 'A reference brief.')
    await writeFile(resolve(root, 'workspace/.rerun/paid-data/people.email.find-2026-10-15-call_1.json'), JSON.stringify({ output: { email: 'jane@acme.com' } }))
    await writeFile(resolve(root, 'workspace/.rerun/pages/acme.com/index.served.html'), '<html><body>Acme</body></html>')
    await writeFile(resolve(root, 'workspace/leaked.md'), 'key is sk-ant-BBBBBBBBBBBBBBBBBBBBBBBB')
    await writeFile(resolve(root, 'workspace/.secrets/linkedin_cookie.json'), JSON.stringify({ li_at: 'AQEDAoPaqueOpaque' }))
    await writeFile(
        resolve(root, 'workspace/.rerun/services.json'),
        JSON.stringify({
            services: {
                fal: { status: 'active', envKeys: ['RERUN_SVC_FAL_FAL_KEY'], mcpServers: ['fal'] },
                'google-indexing': { status: 'active', envKeys: [], managed: { provider: 'google-indexing', serverName: 'google-indexing', accountEmail: 'someone@example.com' } },
                gmail: { status: 'active', label: 'me@acme.com', mcpServers: ['gmail'], composio: { serverName: 'gmail', accountLabel: 'me@acme.com' } },
                'gmail@k3x9ab': { status: 'active', instanceId: 'k3x9ab', label: 'support@acme.com', mcpServers: ['gmail-k3x9ab'], composio: { serverName: 'gmail-k3x9ab', accountLabel: 'support@acme.com' } },
                'gmail@zzzzzz': { status: 'active', instanceId: 'zzzzzz', label: 'Gmail 3', mcpServers: ['gmail-zzzzzz'], composio: { serverName: 'gmail-zzzzzz' } },
            },
        }),
    )
    await writeFile(resolve(root, 'workspace/node_modules/left-pad/index.js'), 'module.exports = 1')
    await writeFile(resolve(root, 'workspace/scripts/__pycache__/veille.pyc'), 'compiled')
    await writeFile(resolve(root, 'config.json.tmp'), 'half-written')
})

describe('listArchivablePaths', () => {
    it('carries the whole agent folder, secrets excepted', async () => {
        const paths = await listArchivablePaths(AGENT_ID)
        expect(paths).toContain('SOUL.md')
        expect(paths).toContain('config.json')
        expect(paths).toContain('.env')
        expect(paths).toContain('skills/research/SKILL.md')
        expect(paths).toContain('schedules/daily.md')
        expect(paths).toContain('triggers/inbound.md')
        expect(paths).toContain('workspace/brief.md')
        expect(paths).toContain('workspace/.rerun/services.json')
        expect(paths).toContain('memory/mem1.md')
        expect(paths).toContain('data/agent.db')
    })

    it('never carries the data the workspace bought', async () => {
        const paths = await listArchivablePaths(AGENT_ID)
        expect(paths.some(p => p.startsWith('workspace/.rerun/paid-data'))).toBe(false)
    })

    it('never carries the pages the coworker read', async () => {
        const paths = await listArchivablePaths(AGENT_ID)
        expect(paths.some(p => p.startsWith('workspace/.rerun/pages'))).toBe(false)
    })

    it('never exposes OAuth bundles, transcripts, retired memories or caches', async () => {
        const paths = await listArchivablePaths(AGENT_ID)
        expect(paths.some(p => p.startsWith('mcp/'))).toBe(false)
        expect(paths.some(p => p.startsWith('data/system.db'))).toBe(false)
        expect(paths.some(p => p.startsWith('memory/archive/'))).toBe(false)
        expect(paths.some(p => p.includes('node_modules') || p.includes('__pycache__'))).toBe(false)
        expect(paths.some(p => p.endsWith('.tmp'))).toBe(false)
    })
})

describe('scrubConfig', () => {
    it('replaces a literal value with a placeholder and reports it', () => {
        const { config: scrubbed, strippedKeys } = scrubConfig(config, AGENT_ID)
        expect(scrubbed.mcpServers[0].env.STRIPE_KEY).toBe('${RERUN_SVC_STRIPE_STRIPE_KEY}')
        expect(scrubbed.mcpServers[0].headers.Authorization).toBe('${RERUN_SVC_STRIPE_AUTHORIZATION}')
        expect(strippedKeys).toEqual(['stripe.env.STRIPE_KEY', 'stripe.headers.Authorization'])
    })

    // The shape the compiler emits and the shape the engine resolver expects. Rewriting it would
    // lose the name of the variable the copy has to be given.
    it('leaves a reference untouched, embedded or not', () => {
        const { config: scrubbed, strippedKeys } = scrubConfig(config, AGENT_ID)
        expect(scrubbed.mcpServers[1].env.FAL_KEY).toBe('${RERUN_SVC_FAL_FAL_KEY}')
        expect(scrubbed.mcpServers[1].headers.Authorization).toBe('Bearer ${RERUN_SVC_FAL_FAL_KEY}')
        expect(strippedKeys.some(key => key.startsWith('fal.'))).toBe(false)
    })

    it('hands the source agent id back as the token the compiler substitutes', () => {
        const { config: scrubbed } = scrubConfig(config, AGENT_ID)
        expect(scrubbed.mcpServers[1].headers['x-rerun-agent']).toBe('${agent.id}')
    })

    // A connection id names a credential on this box and nothing on the one receiving the copy.
    // `provider` is what survives, and what the import resolves a local connection from.
    it('drops the connection and keeps the provider', () => {
        const attached = agentConfigSchema.parse({ ...config, connectionId: 'cnx-local', provider: 'anthropic' })
        const { config: scrubbed } = scrubConfig(attached, AGENT_ID)
        expect(scrubbed.connectionId).toBeNull()
        expect(scrubbed.provider).toBe('anthropic')
    })
})

describe('planArchive', () => {
    // The capture is where a template gets its setup answer, so the plan has to state both the
    // answer and whether instructions actually exist behind a "yes".
    it('reports the setup answer and that instructions travel with the folder', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.setup.required).toBe(true)
        expect(plan.setup.prompt).toContain('Connect the Stripe connector')
        expect(plan.files.find(f => f.path === 'INSTALL.md')?.defaultExcluded).toBe(false)
    })

    it('flags a file that carries a credential', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.files.find(f => f.path === 'workspace/leaked.md')?.flagged).toContain('Anthropic API key')
        expect(plan.files.find(f => f.path === 'workspace/brief.md')?.flagged).toEqual([])
    })

    // A session cookie matches none of the content patterns: the path is the only tell.
    it('flags a secrets folder the content scan cannot see', async () => {
        const plan = await planArchive(AGENT_ID)
        const cookie = plan.files.find(f => f.path === 'workspace/.secrets/linkedin_cookie.json')
        expect(cookie?.flagged).toContain('Secrets folder')
        expect(cookie?.defaultExcluded).toBe(true)
    })

    it('keeps the env key names and clears every value', async () => {
        const plan = await planArchive(AGENT_ID)
        const env = plan.files.find(f => f.path === '.env')
        expect(env?.flagged).toEqual([])
        expect(env?.defaultExcluded).toBe(false)
        expect(plan.envKeys).toEqual(['RERUN_SVC_FAL_FAL_KEY'])
        expect(plan.redactions.some(r => r.path === '.env')).toBe(true)
    })

    it('starts memories unchecked and counts them', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.memoryCount).toBe(1)
        expect(plan.files.find(f => f.path === 'memory/mem1.md')?.defaultExcluded).toBe(true)
    })

    it('names the servers a copy has to re-authorize', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.mcpAuth).toEqual([
            { server: 'fal', kind: 'unknown' },
            { server: 'google-indexing', kind: 'managed' },
        ])
    })

    // The on-disk config.json holds literal keys, but the archive carries the scrubbed one.
    // Flagging the raw file would have the review unchecking a file that is already clean.
    it('scans the scrubbed config, not the file on disk', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.files.find(f => f.path === 'config.json')?.flagged).toEqual([])
    })

    it('projects the connectors, skills and schedules', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.connectorSlugs).toEqual(['fal', 'gmail', 'google-indexing'])
        expect(plan.skills).toEqual([{ slug: 'research', name: 'Research', description: 'Looks things up' }])
        expect(plan.schedules).toEqual([{ slug: 'daily', name: 'Daily', cron: '0 9 * * *' }])
        expect(plan.strippedConfigKeys).toHaveLength(2)
    })

    it('names the webhooks without ever naming their token', async () => {
        const plan = await planArchive(AGENT_ID)
        expect(plan.triggers).toContainEqual({ slug: 'inbound', name: 'Inbound', description: 'A refund arrived', methods: ['POST'], enabled: true })
        expect(JSON.stringify(plan)).not.toContain(TRIGGER_TOKEN)
        expect(plan.redactions.some(r => r.path === 'triggers/inbound.md')).toBe(true)
        expect(plan.files.find(f => f.path === 'triggers/inbound.md')?.defaultExcluded).toBe(false)
    })

    // The token goes on its own, but the instruction is free text the author wrote: a key pasted
    // in there is the same problem as a key pasted in a workspace file.
    it('flags a webhook whose instruction carries a credential', async () => {
        const plan = await planArchive(AGENT_ID)
        const leaky = plan.files.find(f => f.path === 'triggers/leaky.md')
        expect(leaky?.flagged).toContain('Anthropic API key')
        expect(leaky?.defaultExcluded).toBe(true)
    })

    it('honours exclusions', async () => {
        const plan = await planArchive(AGENT_ID, ['workspace/leaked.md'])
        expect(plan.files.some(f => f.path === 'workspace/leaked.md')).toBe(false)
    })
})

describe('buildArchive', () => {
    async function entries(exclude: string[] = []): Promise<string[]> {
        const { stream, bytes } = await buildArchive(AGENT_ID, exclude)
        expect(bytes).toBeGreaterThan(0)
        const found: string[] = []
        await new Promise<void>((done, fail) => {
            stream
                .pipe(list({ onReadEntry: entry => found.push(entry.path.replace(/^\.\//, '')) }) as never)
                .on('end', done)
                .on('error', fail)
        })
        return found
    }

    it('carries the agent folder and none of the credentials', async () => {
        const found = await entries()
        expect(found).toContain('SOUL.md')
        expect(found).toContain('.env')
        expect(found).toContain('data/agent.db')
        expect(found).toContain('workspace/.rerun/services.json')
        expect(found).toContain('.rerun-capture.json')
        expect(found.some(p => p.startsWith('mcp/') || p.startsWith('data/system.db') || p.includes('node_modules'))).toBe(false)
    })

    it('drops an excluded file', async () => {
        expect(await entries(['workspace/leaked.md'])).not.toContain('workspace/leaked.md')
    })

    it('writes redacted bytes, not the originals', async () => {
        const { stream } = await buildArchive(AGENT_ID)
        const staged = mkdtempSync(resolve(tmpdir(), 'rerun-unpack-'))
        const { extract } = await import('tar')
        await new Promise<void>((done, fail) => {
            stream
                .pipe(extract({ cwd: staged }) as never)
                .on('finish', done)
                .on('error', fail)
        })

        const env = await readFile(resolve(staged, '.env'), 'utf8')
        expect(env).toBe('RERUN_SVC_FAL_FAL_KEY=\n')
        expect(env).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
        expect(env).not.toContain('OPENCODE_API_KEY')

        const scrubbed = JSON.parse(await readFile(resolve(staged, 'config.json'), 'utf8')) as typeof config
        expect(scrubbed.mcpServers[1].headers.Authorization).toBe('Bearer ${RERUN_SVC_FAL_FAL_KEY}')
        expect(scrubbed.mcpServers[0].env.STRIPE_KEY).toBe('${RERUN_SVC_STRIPE_STRIPE_KEY}')

        const registry = JSON.parse(await readFile(resolve(staged, 'workspace/.rerun/services.json'), 'utf8')) as {
            services: Record<string, { status: string; label?: string; instanceId?: string; managed?: { accountEmail?: string }; composio?: Record<string, string> }>
        }
        expect(registry.services.fal.status).toBe('needs_config')
        expect(registry.services['google-indexing'].status).toBe('needs_auth')
        expect(registry.services['google-indexing'].managed?.accountEmail).toBeUndefined()
        expect(Object.keys(registry.services)).toContain('gmail@k3x9ab')
        expect(registry.services['gmail@k3x9ab'].instanceId).toBe('k3x9ab')
        expect(registry.services['gmail@k3x9ab'].composio).toEqual({ serverName: 'gmail-k3x9ab' })
        expect(registry.services.gmail.composio).toEqual({ serverName: 'gmail' })
        expect(registry.services.gmail.label).toBeUndefined()
        expect(registry.services['gmail@k3x9ab'].label).toBeUndefined()
        expect(registry.services['gmail@zzzzzz'].label).toBe('Gmail 3')

        const trigger = await readFile(resolve(staged, 'triggers/inbound.md'), 'utf8')
        expect(trigger).not.toContain(TRIGGER_TOKEN)
        expect(trigger).toContain("token: ''")
        expect(trigger).toContain('enabled: false')
        expect(trigger).toContain('A Stripe refund event arrives, record it.')
        expect(trigger).toContain('fireCount: 0')

        const manifest = JSON.parse(await readFile(resolve(staged, '.rerun-capture.json'), 'utf8')) as { envKeys: string[]; sourceAgentId: string }
        expect(manifest.sourceAgentId).toBe(AGENT_ID)
        expect(manifest.envKeys).toEqual(['RERUN_SVC_FAL_FAL_KEY'])
    })
})

describe('scrubConfig on an agent that picked no model', () => {
    it('exports as "box default" rather than freezing whatever the source box happened to run', () => {
        const boxDefault = agentConfigSchema.parse({ name: 'archived' })
        const { config } = scrubConfig(boxDefault, AGENT_ID)
        expect(config.model).toBeNull()
        expect(config.provider).toBeNull()
        expect(config.connectionId).toBeNull()
    })
})
