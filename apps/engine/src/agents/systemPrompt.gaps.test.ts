import { mkdtempSync } from 'node:fs'
import type { ModelMessage } from 'ai'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-system-prompt-gaps-'))
process.env.RERUN_API_KEY = ''

const { vi } = await import('vitest')

type Source = 'skills' | 'schedules' | 'triggers' | 'memory' | 'agentDb' | 'sharedDb' | 'mcp'

const sources = vi.hoisted(() => ({
    text: {} as Partial<Record<string, string>>,
    failing: new Set<string>(),
    memories: [] as Array<{ id: string; content: string; kind: string; tags: string[]; createdAt: string; strength: number }>,
    recallFails: false,
    recallCalls: [] as Array<{ query: string; k: number; opts: unknown }>,
}))

function stub(name: Source) {
    return async (): Promise<string> => {
        if (sources.failing.has(name)) throw new Error(`${name} unavailable`)
        return sources.text[name] ?? ''
    }
}

vi.mock('../skills/index.js', () => ({ buildSkillIndex: stub('skills') }))
vi.mock('../schedules/index.js', () => ({ buildScheduleIndex: stub('schedules') }))
vi.mock('../triggers/index.js', () => ({ buildTriggerIndex: stub('triggers') }))
vi.mock('../memory/index.js', () => ({ buildMemoryIndex: stub('memory') }))
vi.mock('../tools/mcp-index.js', () => ({ buildMcpIndex: stub('mcp') }))
vi.mock('../db/agentDb.js', async importOriginal => ({ ...(await importOriginal<object>()), readAgentDbSchema: stub('agentDb') }))
vi.mock('../db/sharedDb.js', async importOriginal => {
    const original = await importOriginal<typeof import('../db/sharedDb.js')>()
    return {
        ...original,
        readSharedDbSchema: async (options: Parameters<typeof original.readSharedDbSchema>[0]) => {
            if (sources.failing.has('sharedDb')) throw new Error('sharedDb unavailable')
            return original.readSharedDbSchema(options)
        },
    }
})
vi.mock('../memory/store.js', () => ({
    AUTO_RECALL_MIN_SIMILARITY: 0.25,
    recallMemory: async (_agent: unknown, query: string, k: number, opts: unknown) => {
        sources.recallCalls.push({ query, k, opts })
        if (sources.recallFails) throw new Error('embedder down')
        return sources.memories
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { agentConfigSchema } = await import('@rerun/contracts')
const { buildSystemPrompt: buildSystemPromptBlocks, systemPromptText, recallMemories, recallSection } = await import('./systemPrompt.js')
const recallContext = async (agent: Parameters<typeof recallMemories>[0], userText: string, history?: ModelMessage[]) => recallSection(await recallMemories(agent, userText), history)
const { contextTextPart } = await import('@rerun/contracts')

// The tests read the prompt as the model does, both blocks joined.
const buildSystemPrompt = async (...args: Parameters<typeof buildSystemPromptBlocks>) => systemPromptText(await buildSystemPromptBlocks(...args))
const { getSharedDb } = await import('../db/sharedDb.js')
const { workspaceDir, sharedDir } = await import('../config/paths.js')

function agentWith(overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return {
        id: 'gapsagent',
        config: agentConfigSchema.parse({ name: 'Gaps', provider: 'rerun', ...overrides }),
        soul: 'You are a test agent.',
        install: '',
        env: {},
        resolved: { connection: null, provider: 'rerun', model: 'rerun-max' },
        ...extra,
    } as any
}

const everyIndex = { skills: true, schedule: true, trigger: true, memory: true, db: true, sharedDb: false }

beforeEach(() => {
    sources.text = {}
    sources.failing.clear()
    sources.memories = []
    sources.recallFails = false
    sources.recallCalls = []
})

describe('buildSystemPrompt state sections', () => {
    it('gives each index its own section', async () => {
        sources.text = {
            skills: '- weekly-report: how the weekly report is built',
            schedules: '- daily-digest: every day at 09:00 UTC',
            triggers: '- stripe-webhook: POST /t/abc',
            memory: '- (preference) prefers bullet points',
            agentDb: 'leads(id INTEGER PK, name TEXT)',
            mcp: '- notion (http): authenticated (OAuth)',
        }

        const prompt = await buildSystemPrompt(agentWith({ tools: everyIndex }))

        expect(prompt).toMatch(/<skills>\n- weekly-report: how the weekly report is built/)
        expect(prompt).toContain('<scheduled_tasks>\n- daily-digest: every day at 09:00 UTC\n</scheduled_tasks>')
        expect(prompt).toContain('<webhook_triggers>\n- stripe-webhook: POST /t/abc\n</webhook_triggers>')
        expect(prompt).toContain('<memory_index>\n- (preference) prefers bullet points\n</memory_index>')
        expect(prompt).toMatch(/<database>[\s\S]*\n\nleads\(id INTEGER PK, name TEXT\)\n<\/database>/)
        expect(prompt).toContain('<connected_services>\n- notion (http): authenticated (OAuth)\n</connected_services>')
        expect(prompt).not.toContain('You have no skill yet')
    })

    // What moves between two turns goes last, in its own block, so a memory written or a table
    // created rewrites that block alone in the provider's cache and not the rules after it.
    it('keeps the indexes, the schemas and the day in the volatile block, after every rule', async () => {
        sources.text = { schedules: '- daily-digest', memory: '- (fact) x', agentDb: 'leads(id)', mcp: '- notion' }

        const { stable, volatile } = await buildSystemPromptBlocks(agentWith({ tools: everyIndex }))

        for (const tag of ['skills', 'scheduled_tasks', 'memory_index', 'database', 'connected_services', 'current_time']) {
            expect(volatile).toContain(`<${tag}>`)
            expect(stable).not.toContain(`<${tag}>`)
        }
        for (const tag of ['identity', 'operating_notes', 'asking_the_user', 'environment']) {
            expect(stable).toContain(`<${tag}>`)
            expect(volatile).not.toContain(`<${tag}>`)
        }
        expect(systemPromptText({ stable, volatile })).toBe(`${stable}\n\n${volatile}`)
    })

    // One broken store (a corrupt skill folder, a locked database) must not take down every run of
    // the agent: its section just goes missing.
    it('still builds the prompt when every index fails', async () => {
        sources.failing = new Set<Source>(['skills', 'schedules', 'triggers', 'memory', 'agentDb', 'sharedDb', 'mcp'])

        const prompt = await buildSystemPrompt(agentWith({ tools: { ...everyIndex, sharedDb: true } }))

        expect(prompt).toContain('<identity>\nYou are a test agent.\n</identity>')
        expect(prompt).toContain('You have no skill yet')
        expect(prompt).not.toContain('<scheduled_tasks>')
        expect(prompt).not.toContain('<webhook_triggers>')
        expect(prompt).not.toContain('<memory_index>')
        expect(prompt).not.toContain('<connected_services>')
        expect(prompt).toMatch(/<database>[\s\S]*ask the user before choosing\.\n<\/database>/)
        expect(prompt).toMatch(/<shared_database>[\s\S]*at the same time\.\n<\/shared_database>/)
    })

    it('falls back to the default soul when the agent has none', async () => {
        const prompt = await buildSystemPrompt(agentWith({ name: 'Scout', tools: { memory: false, db: false, schedule: false } }, { soul: '   ' }))
        expect(prompt).toMatch(/<identity>\n\S[\s\S]*<\/identity>/)
        expect(prompt).not.toContain('You are a test agent.')
    })
})

describe('buildSystemPrompt guided setup', () => {
    it('adds the setup section while an install is pending', async () => {
        const pending = agentWith({ setup: { required: true, completedAt: null } }, { install: '1. Connect Gmail.' })
        const prompt = await buildSystemPrompt(pending)
        expect(prompt).toContain('<setup>')
        expect(prompt).toContain('call install_complete')
    })

    // Published INSTALL.md files still say "connect everything first": the setup note is what puts
    // a first result ahead of the connection cards for them.
    it('puts a first result ahead of the connections, over the order the instructions list', async () => {
        const pending = agentWith({ setup: { required: true, completedAt: null } }, { install: '1. Connect Gmail.' })
        const prompt = await buildSystemPrompt(pending)
        expect(prompt).toContain('takes precedence over the order the instructions list')
        expect(prompt).toContain('only then offer the apps that are still missing')
    })

    it('never rushes a result, during setup or after', async () => {
        const pending = agentWith({ setup: { required: true, completedAt: null } }, { install: '1. Connect Gmail.' })
        const prompt = await buildSystemPrompt(pending)
        expect(prompt).toContain('a relevant result is worth more than a fast one')
        expect(prompt).toContain('checked before you show it')
        expect(prompt).not.toContain('Show a result before you ask')
        expect(prompt).not.toContain('result of your job right away')
    })

    it('writes the work in the language the user writes in, whatever language their website is in', async () => {
        const pending = agentWith({ setup: { required: true, completedAt: null } }, { install: '1. Connect Gmail.' })
        const prompt = await buildSystemPrompt(pending)
        expect(prompt).toContain("they are the publisher's words, not the user's: like their website or their data, their language never decides the one you write in")
        expect(prompt).toContain('The work you deliver (posts, emails, drafts, reports) follows the same language')
    })

    it('writes a text meant for someone else in that person\'s language, whatever the user writes in', async () => {
        const prompt = await buildSystemPrompt(agentWith())
        const section = prompt.slice(prompt.indexOf('<language>'), prompt.indexOf('</language>'))
        expect(section).toContain("A text written for someone else (a prospect, a candidate, a customer) is in that person's language")
        expect(section).toContain('whatever language the user writes to you in')
    })

    it('counts paid_data among what works without any connection, only for a coworker that has it', async () => {
        const setupOf = (prompt: string) => prompt.slice(prompt.indexOf('<setup>'), prompt.indexOf('</setup>'))
        const withPaidData = agentWith({ setup: { required: true, completedAt: null } }, { install: '1. Connect Gmail.' })
        expect(setupOf(await buildSystemPrompt(withPaidData))).toContain('paid_data needs no connection either')
        expect(setupOf(await buildSystemPrompt(withPaidData))).toContain('checked under the paid_data rules before you show it (five rows that meet every criterion beat twenty-five raw ones)')
        const withoutPaidData = agentWith({ setup: { required: true, completedAt: null }, tools: { paidData: false } }, { install: '1. Connect Gmail.' })
        expect(setupOf(await buildSystemPrompt(withoutPaidData))).not.toContain('paid_data')
    })

    it('drops it once the install is complete', async () => {
        const done = agentWith({ setup: { required: true, completedAt: '2026-09-01T00:00:00.000Z' } }, { install: '1. Connect Gmail.' })
        expect(await buildSystemPrompt(done)).not.toContain('<setup>')
    })
})

describe('buildSystemPrompt language', () => {
    it('tells a coworker with no pending setup to write in the language the user writes in', async () => {
        const prompt = await buildSystemPrompt(agentWith())
        expect(prompt).toContain('<language>')
        expect(prompt).toContain('Everything you address to the user is in the language they write to you in')
        expect(prompt).toContain('check the language of the conversation before you write your final message')
    })

    it('lets the user, the identity or a skill set another language for a piece of work', async () => {
        expect(await buildSystemPrompt(agentWith())).toContain('unless the user, your identity or a skill sets another one for that piece of work')
    })

    it('holds on a run no person started', async () => {
        const prompt = await buildSystemPrompt(agentWith(), { source: 'schedule' })
        expect(prompt).toContain('<language>')
        expect(prompt).toContain('keep the language of the last messages a person wrote in this session')
    })

    it('leaves it out for a sub-agent, whose only reader is the coworker that called it', async () => {
        expect(await buildSystemPrompt(agentWith({ ephemeral: true }))).not.toContain('<language>')
    })
})

describe('buildSystemPrompt unattended runs', () => {
    it.each([
        ['schedule', 'a scheduled routine'],
        ['trigger', 'an incoming webhook call'],
    ] as const)('names the %s as the origin of a run nobody watches', async (source, origin) => {
        const prompt = await buildSystemPrompt(agentWith({ tools: { askUser: true } }), { source, slug: 's', name: 'S' } as any)
        expect(prompt).toContain('<unattended_run>')
        expect(prompt).toContain(origin)
    })

    it('leaves the note out for an agent that cannot ask anything', async () => {
        const prompt = await buildSystemPrompt(agentWith({ tools: { askUser: false, requestApproval: false, suggestService: false, requestSecret: false } }), { source: 'schedule', slug: 's', name: 'S' } as any)
        expect(prompt).not.toContain('<unattended_run>')
        expect(prompt).not.toContain('<asking_the_user>')
    })
})

describe('buildSystemPrompt shared schema', () => {
    // The shared schema is paid on every run of every agent in the workspace, so it is capped.
    it('caps the shared schema and points at shared_db_schema for the rest', async () => {
        const client = await getSharedDb()
        for (let i = 0; i < 45; i++) await client.execute(`CREATE TABLE IF NOT EXISTS t${String(i).padStart(2, '0')} (id INTEGER PRIMARY KEY)`)

        const prompt = await buildSystemPrompt(agentWith({ tools: { sharedDb: true } }))

        expect(prompt).toContain('<shared_database>')
        expect(prompt).toMatch(/\.\.\. and \d+ more tables, call shared_db_schema to see them\./)
    })
})

describe('buildSystemPrompt for the foreman', () => {
    const foreman = (overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
        agentWith({ kind: 'foreman', name: 'Foreman', ...overrides }, { id: 'foremangaps', soul: 'Soul fallback.', brief: { instructions: '  You are the Foreman. Charter from the hub.  ', tools: [] }, ...extra })

    it('gives the foreman the company brain, and drops it when the brain tools are off', async () => {
        expect(await buildSystemPrompt(foreman())).toContain('<company_brain>')
        expect(await buildSystemPrompt(foreman({ tools: { brain: false } }))).not.toContain('<company_brain>')
    })

    it('uses the hub charter as its identity and roots it in its own workspace', async () => {
        const prompt = await buildSystemPrompt(foreman())

        expect(prompt).toContain('<identity>\nYou are the Foreman. Charter from the hub.\n</identity>')
        expect(prompt).toContain(`Your own workspace is ${workspaceDir('foremangaps')}`)
        expect(prompt).toContain(sharedDir())
        expect(prompt).toContain('agent_files_')
        expect(prompt).toContain('<asking_the_user>')
        expect(prompt).not.toContain('<skills>')
        expect(prompt).not.toContain('<memory_index>')
        expect(prompt).not.toContain('<database>')
    })

    it('shows what it asks about in the turn that asks, without the chat-only draft block', async () => {
        const prompt = await buildSystemPrompt(foreman())
        const section = prompt.slice(prompt.indexOf('<asking_the_user>'), prompt.indexOf('</asking_the_user>'))
        expect(section).toContain('Having shown it a few messages earlier does not count')
        expect(section).toContain('a tag like <ask_user> shows to the user as raw text')
        expect(prompt).not.toContain('```draft')
    })

    it('falls back to its soul when no brief arrived', async () => {
        const prompt = await buildSystemPrompt(foreman({}, { brief: undefined }))
        expect(prompt).toContain('<identity>\nSoul fallback.\n</identity>')
    })

    it('reads the shared database without a write licence', async () => {
        const prompt = await buildSystemPrompt(foreman({ tools: { sharedDb: true } }))
        expect(prompt).toContain('<shared_database>')
        expect(prompt).toContain('Write to it only when the user asked for it')
    })

    it('still answers when the shared schema cannot be read', async () => {
        sources.failing.add('sharedDb')
        const prompt = await buildSystemPrompt(foreman({ tools: { sharedDb: true } }))
        expect(prompt).toMatch(/<shared_database>\nThe workspace has one shared SQL database[^<]*without their approval\.\n<\/shared_database>/)
    })

    it('adds the bridge note and the call-first order on codex', async () => {
        const prompt = await buildSystemPrompt(foreman(), { source: 'chat' }, 'codex')
        expect(prompt).toContain('<bridged_tools>')
        expect(prompt).toContain('a message written before a call does not reach the user as your message')
    })

    it('adds the bridge note and the call-first order on claude', async () => {
        const prompt = await buildSystemPrompt(foreman(), { source: 'chat' }, 'claude')
        expect(prompt).toContain('<bridged_tools>')
        expect(prompt).toContain('a message written before a call does not reach the user as your message')
    })
})

describe('recallContext', () => {
    it('lists the memories close enough to the message with their kind, touching them lightly', async () => {
        sources.memories = [
            { id: 'm1', content: 'Prefers bullet points', kind: 'preference', tags: [], createdAt: '', strength: 1 },
            { id: 'm2', content: 'Works for Acme', kind: 'fact', tags: [], createdAt: '', strength: 1 },
        ]

        const context = await recallContext(agentWith({ tools: { memory: true } }), 'write the weekly report')

        expect(context).toBe('<relevant_memories>\n- (preference) Prefers bullet points\n- (fact) Works for Acme\n</relevant_memories>')
        expect(sources.recallCalls).toEqual([{ query: 'write the weekly report', k: 5, opts: { reinforce: 'touch', minSimilarity: 0.25 } }])
    })

    it('adds nothing when nothing comes back', async () => {
        expect(await recallContext(agentWith({ tools: { memory: true } }), 'hello')).toBe('')
    })

    // The turn is stored as sent, so a memory injected earlier in the conversation is already in
    // front of the model: sending it again would only grow the history.
    it('leaves out a memory the conversation already holds', async () => {
        sources.memories = [
            { id: 'm1', content: 'Prefers bullet points', kind: 'preference', tags: [], createdAt: '', strength: 1 },
            { id: 'm2', content: 'Works for Acme', kind: 'fact', tags: [], createdAt: '', strength: 1 },
        ]
        const history: ModelMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'earlier' }, contextTextPart('<relevant_memories>\n- (fact) Works for Acme\n</relevant_memories>')] },
            { role: 'assistant', content: 'Works for Acme, noted.' },
        ]

        expect(await recallContext(agentWith({ tools: { memory: true } }), 'write the weekly report', history)).toBe('<relevant_memories>\n- (preference) Prefers bullet points\n</relevant_memories>')
        sources.memories = [sources.memories[1]]
        expect(await recallContext(agentWith({ tools: { memory: true } }), 'write the weekly report', history)).toBe('')
    })

    // Seen means the same line was sent, not that the words appear somewhere in a longer memory.
    it('still sends a memory that is only a prefix of one the conversation holds', async () => {
        sources.memories = [{ id: 'm1', content: 'Works for Acme', kind: 'fact', tags: [], createdAt: '', strength: 1 }]
        const history: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'earlier' }, contextTextPart('<relevant_memories>\n- (fact) Works for Acme Corp since 2020\n</relevant_memories>')] }]

        expect(await recallContext(agentWith({ tools: { memory: true } }), 'who do I work for', history)).toBe('<relevant_memories>\n- (fact) Works for Acme\n</relevant_memories>')
    })

    it('adds nothing when the recall fails', async () => {
        sources.recallFails = true
        expect(await recallContext(agentWith({ tools: { memory: true } }), 'hello')).toBe('')
    })

    it('does not search at all without memory or without text', async () => {
        expect(await recallContext(agentWith({ tools: { memory: false } }), 'hello')).toBe('')
        expect(await recallContext(agentWith({ tools: { memory: true } }), '')).toBe('')
        expect(sources.recallCalls).toEqual([])
    })
})
