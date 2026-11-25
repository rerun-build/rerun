import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

const dataDir = mkdtempSync(resolve(tmpdir(), 'brand-prompts-'))
process.env.RERUN_DATA_DIR = dataDir
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_REMOTE_COMPUTERS = 'on'

vi.mock('../tools/mcp-pool.js', async importOriginal => ({ ...(await importOriginal<typeof import('../tools/mcp-pool.js')>()), pooledMcpServers: async () => [] }))
vi.mock('../desktop/session.js', async importOriginal => ({ ...(await importOriginal<typeof import('../desktop/session.js')>()), desktopAvailable: () => true, computerAvailable: () => true }))
vi.mock('../paid-data/price.js', async importOriginal => ({ ...(await importOriginal<typeof import('../paid-data/price.js')>()), paidDataOffered: async () => true, paidDataOfferedSoFar: () => true }))

const { describe, expect, it } = await import('vitest')
const { asSchema } = await import('ai')
const { agentConfigSchema } = await import('@rerun/contracts')

const NORDLYS = { name: 'Nordlys', whiteLabel: true, supportEmail: 'help@nordlys.example' }
const RUNTIMES = [
    ['rerun', 'openai/gpt-6-sol'],
    ['anthropic', 'claude-sonnet-5'],
    ['claude', 'claude-opus-5-5'],
    ['codex', 'gpt-6-sol'],
] as const
const KINDS = ['coworker', 'foreman', 'ephemeral', 'bare'] as const
const TRIGGERS = [
    { source: 'chat', teamRequests: true },
    { source: 'chat', calledBy: { id: 'a', name: 'A', waiting: true } },
    { source: 'schedule', slug: 's', name: 's' },
    { source: 'trigger', slug: 's', name: 's' },
    { source: 'job', computer: 'c', jobId: 'j' },
    { source: 'checkin', slug: 'c', name: 'c', reason: 'pulse' },
] as const
const FULL = { paidData: true, cards: true, quickReplies: true, skills: true, askUser: true, requestApproval: true, suggestService: true, requestSecret: true, browser: true, computer: true, remoteComputers: true }
const BARE = { hub: false, paidData: false, web: false }
const quiet = { warn() {}, info() {}, error() {}, debug() {} }

// A fresh process under that brand: the same data-dir, read again.
async function under(brand: unknown) {
    writeFileSync(resolve(dataDir, 'brand.json'), JSON.stringify(brand))
    vi.resetModules()
    const { buildSystemPrompt, systemPromptText } = await import('../agents/systemPrompt.js')
    const { buildTools } = await import('../tools/registry.js')
    const { toolCatalog } = await import('../tools/catalog.js')
    const { turnOrder } = await import('../agents/turn-order.js')
    const { ensureForeman } = await import('../agents/foreman.js')
    const { upsertComputer } = await import('../remote/store.js')
    const { readFileSync } = await import('node:fs')
    const { soulPath } = await import('../config/paths.js')
    await upsertComputer({ id: 'c1', handle: 'studio-pc', name: 'Studio PC' })
    await ensureForeman()
    const texts = new Map<string, string>()
    for (const [provider, model] of RUNTIMES)
        for (const kind of KINDS) {
            const foreman = kind === 'foreman'
            const agent = {
                id: foreman ? 'foreman' : 'brand-agent',
                config: agentConfigSchema.parse({ name: 'Brand', provider, kind: foreman ? 'foreman' : 'user', ephemeral: kind === 'ephemeral', tools: kind === 'bare' ? BARE : FULL }),
                soul: foreman ? readFileSync(soulPath('foreman'), 'utf8') : '',
                install: '',
                env: {},
                resolved: { connection: null, provider, model },
            } as never
            const order = turnOrder(provider, model)
            for (const trigger of TRIGGERS) texts.set(`${kind} ${provider} ${trigger.source} ${'calledBy' in trigger}`, systemPromptText(await buildSystemPrompt(agent, trigger as never, provider, order)))
            for (const readOnly of foreman ? [false, true] : [false]) {
                const { tools, close } = await buildTools({ agent, sessionId: 's', logger: quiet, provider, model, turnOrder: order, readOnly } as never)
                await close()
                for (const [name, tool] of Object.entries(tools)) texts.set(`tool ${name} ${kind} ${provider} ${readOnly}`, `${tool.description ?? ''}\n${JSON.stringify(await asSchema(tool.inputSchema).jsonSchema)}`)
            }
        }
    texts.set('catalog', JSON.stringify(toolCatalog()))
    return texts
}

const PRODUCT_NOTE = /<product>[\s\S]*?<\/product>/
// What a model may still read of the word: an identifier, which the product section tells it to keep to itself.
const IDENTIFIER = /\bmcp__rerun__|\brerun_[a-z_]+|\bRERUN_[A-Z_]+|\.rerun\/|\/opt\/rerun\b|named rerun\b|\\?"rerun\\?"|\/[\w./-]*rerun[\w./-]*/g

describe('the prompts of a machine under a brand', async () => {
    const rerun = await under({ name: 'Rerun', whiteLabel: false, supportEmail: null })
    const nordlys = await under(NORDLYS)

    it('never name Rerun nor its addresses, in any prompt or tool', () => {
        expect(nordlys.size).toBeGreaterThan(100)
        const leaks = [...nordlys].flatMap(([where, text]) => {
            const read = text.replace(PRODUCT_NOTE, '').replace(IDENTIFIER, '')
            return [...read.matchAll(/.{0,60}(?:rerun|discord).{0,60}/gi)].map(match => `${where}: ${match[0]}`)
        })
        expect([...new Set(leaks)]).toEqual([])
    })

    it('say what the product is called, and where help is, in every prompt of a run', () => {
        for (const [where, text] of nordlys) {
            if (where.startsWith('tool ') || where === 'catalog') continue
            expect(text, where).toMatch(/<product>\nThe product you are part of is called Nordlys/)
            expect(text, where).toContain('help@nordlys.example')
        }
    })

    it('offer no request to a team', () => {
        for (const [where, text] of nordlys) expect(text, where).not.toContain('request_feature')
        expect([...rerun.values()].some(text => text.includes('<rerun_team_requests>'))).toBe(true)
    })

    it('carry nothing of a brand under Rerun', () => {
        for (const [where, text] of rerun) {
            expect(text, where).not.toContain('<product>')
            expect(text, where).not.toContain('Nordlys')
        }
    })
})
