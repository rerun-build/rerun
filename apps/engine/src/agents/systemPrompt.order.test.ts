import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-prompt-order-'))
process.env.RERUN_API_KEY = ''

vi.mock('../tools/mcp-pool.js', async importOriginal => ({ ...(await importOriginal<typeof import('../tools/mcp-pool.js')>()), pooledMcpTools: async () => ({}) }))
vi.mock('../desktop/session.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../desktop/session.js')>()),
    desktopAvailable: () => true,
    computerAvailable: () => true,
}))

const { describe, expect, it } = await import('vitest')
const { asSchema } = await import('ai')
const { agentConfigSchema } = await import('@rerun/contracts')
const { buildSystemPrompt, systemPromptText } = await import('./systemPrompt.js')
const { buildTools } = await import('../tools/registry.js')
const { HITL_TOOL_NAMES, HITL_TOOL_SET } = await import('../tools/builtin/hitl.js')
const { cardCallTiming, turnOrder } = await import('./turn-order.js')

// Every runtime reads the same rules, so the one place that orders a turn is the only text allowed
// to say whether the message or a call comes first. A Rerun alias reaches here already resolved to
// the model the hub serves it with.
const RUNTIMES = [
    ['rerun', 'anthropic/claude-haiku-5.5'],
    ['rerun', 'openai/gpt-6-sol'],
    ['anthropic', 'claude-sonnet-5'],
    ['openai', 'gpt-6-sol'],
    ['openrouter', 'anthropic/claude-sonnet-5'],
    ['claude', 'claude-opus-5-5'],
    ['codex', 'gpt-6-sol'],
] as const
type Provider = (typeof RUNTIMES)[number][0]
// The big-spend rule stops "before the call that crosses" the credit line: that is about money, not about the turn.
const ORDER_WORDING = /before (this|the) call(?! that crosses)|after (this|the) call|right before (writing )?(that|your) final message|call it first|produce no further output/i

const quiet = { warn() {}, info() {}, error() {}, debug() {} }

const CONFIGS = {
    full: { tools: { paidData: true, cards: true, quickReplies: true, skills: true, askUser: true, requestApproval: true, suggestService: true, requestSecret: true, browser: true, computer: true } },
    minimal: { tools: { askUser: true, requestApproval: false, suggestService: false, requestSecret: false, quickReplies: false, skills: false, paidData: false, cards: false, hub: false, db: false, sharedDb: false, browser: false, computer: false }, selfImprovement: { enabled: false } },
} as const

function agentFor(provider: Provider, config: (typeof CONFIGS)[keyof typeof CONFIGS], model = 'm') {
    return {
        id: 'order-agent',
        config: agentConfigSchema.parse({ name: 'Order test', provider, ...config }),
        soul: 'You are a test agent.',
        install: '',
        env: {},
        resolved: { connection: null, provider, model },
    } as any
}

async function promptFor(provider: Provider, config: keyof typeof CONFIGS, model = 'm') {
    return systemPromptText(await buildSystemPrompt(agentFor(provider, CONFIGS[config], model), { source: 'chat' }, provider))
}

const sectionOf = (prompt: string, tag: string) => prompt.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))?.[1] ?? null
const withoutSection = (prompt: string, tag: string) => prompt.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`), '')

describe.each(RUNTIMES)('the order of a turn on %s running %s', (provider, model) => {
    const order = turnOrder(provider, model)

    it.each(Object.keys(CONFIGS) as (keyof typeof CONFIGS)[])('is said once, in turn_order, with a %s config', async config => {
        const prompt = await promptFor(provider, config, model)
        expect(prompt.match(/<turn_order>/g)).toHaveLength(1)
        const note = sectionOf(prompt, 'turn_order') ?? ''
        expect(note).toContain('in full, what the card asks about')
        if (order === 'call-first') expect(note).toContain('a message written before a call does not reach the user as your message')
        else {
            expect(note).toContain('A turn ends in this order, your message first')
            expect(note).toContain('make it in the same reply as your message')
        }
        expect(withoutSection(prompt, 'turn_order')).not.toMatch(ORDER_WORDING)
    })

    it('repeats the order of turn_order on each card, and nowhere else among the tools', async () => {
        const ctx = { agent: agentFor(provider, CONFIGS.full, model), sessionId: 's', logger: quiet, provider, model, turnOrder: order } as any
        const { tools, close } = await buildTools(ctx)
        await close()
        expect(Object.keys(tools)).toEqual(expect.arrayContaining(['ask_user', 'request_approval', 'skill_propose', 'card_file']))
        expect(Object.keys(tools)).not.toContain('suggest_replies')
        const timing = cardCallTiming(order)
        const otherTiming = cardCallTiming(order === 'call-first' ? 'message-first' : 'call-first')
        for (const [name, t] of Object.entries(tools)) {
            const text = `${t.description ?? ''} ${JSON.stringify(asSchema(t.inputSchema).jsonSchema)}`
            if (HITL_TOOL_SET.has(name)) expect(t.description, name).toContain(timing)
            else expect(text, name).not.toContain(timing)
            expect(text, name).not.toContain(otherTiming)
            expect(text, name).not.toMatch(ORDER_WORDING)
        }
    })
})

describe('the sections a prompt points at', () => {
    it.each(RUNTIMES.flatMap(([p, m]) => (Object.keys(CONFIGS) as (keyof typeof CONFIGS)[]).map(c => [p, m, c] as const)))('exist on %s running %s with a %s config', async (provider, model, config) => {
        const prompt = await promptFor(provider, config, model)
        const named = [...prompt.matchAll(/\(see ([a-z_]+)\)|set in ([a-z_]+)|in your ([a-z_]+) section/g)].map(m => m[1] ?? m[2] ?? m[3])
        for (const tag of named) expect(prompt, tag).toContain(`<${tag}>`)
    })

    it('says the schemas come further down, where they are', async () => {
        const prompt = await promptFor('rerun', 'full')
        expect(prompt).toContain('The database schemas further down')
        expect(prompt.indexOf('<chat_cards>')).toBeLessThan(prompt.indexOf('<database>'))
    })

    it('points at the skill proposal only where the skills section holds it', async () => {
        expect(await promptFor('rerun', 'full')).toContain('described in your skills section')
        expect(await promptFor('rerun', 'minimal')).not.toContain('skill proposal')
    })
})

describe('a sub-coworker', () => {
    it('gets no turn order, since nobody reads its messages', async () => {
        const delegate = agentFor('rerun', CONFIGS.full)
        delegate.config.ephemeral = true
        expect(systemPromptText(await buildSystemPrompt(delegate, { source: 'chat' }, 'rerun'))).not.toContain('<turn_order>')
    })
})

describe('the cards that close a turn', () => {
    it('are all named in turn_order when the agent has them all', async () => {
        const note = sectionOf(await promptFor('rerun', 'full'), 'turn_order') ?? ''
        for (const name of HITL_TOOL_NAMES) expect(note, name).toContain(name)
    })

    it('are only the ones the agent can call', async () => {
        const note = sectionOf(await promptFor('rerun', 'minimal'), 'turn_order') ?? ''
        expect(note).toContain('ask_user')
        expect(note).not.toContain('request_approval')
        expect(note).not.toContain('suggest_replies')
    })
})

describe('a rule with one home', () => {
    it.each(['Group every open question', 'paste secrets', 'Keep each app reason to one short line', 'comes after you showed it, never instead'])('"%s" is stated once at most', async rule => {
        const prompt = await promptFor('rerun', 'full')
        expect(prompt.split(rule).length - 1).toBeLessThanOrEqual(1)
    })
})
