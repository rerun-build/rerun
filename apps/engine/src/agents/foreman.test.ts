import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-foreman-'))

const { hubCalls } = vi.hoisted(() => ({ hubCalls: [] as Array<{ agentId: string; tool: string; args: Record<string, unknown> }> }))

vi.mock('../runtime/hub.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/hub.js')>()),
    callHub: async (caller: { id: string }, tool: string, args: Record<string, unknown>) => {
        hubCalls.push({ agentId: caller.id, tool, args })
        return { ok: true, tool }
    },
}))

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { FOREMAN_AGENT_ID, FOREMAN_INTENT_PART, foremanBriefSchema } = await import('@rerun/contracts')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('./foreman.js')
const { getAgent } = await import('./registry.js')
const { createAgent } = await import('./factory.js')
const { listAgentIndex } = await import('../db/repos/agents.js')
const { buildTools } = await import('../tools/registry.js')
const { buildSystemPrompt, systemPromptText } = await import('./systemPrompt.js')
const { createServer } = await import('../http/server.js')
const { logger } = await import('../lib/logger.js')

const brief = foremanBriefSchema.parse({
    instructions: 'You are the Foreman. Charter from the hub.',
    tools: [
        {
            name: 'create_agent',
            description: 'Create an agent.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
            kind: 'hub',
            serial: true,
        },
        { name: 'list_agents', description: 'List agents.', inputSchema: { type: 'object', properties: {} }, kind: 'hub' },
        {
            name: 'focus_agent',
            description: 'Open an agent panel.',
            inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
            kind: 'intent',
        },
        { name: 'ask_user', description: 'Shadowing a builtin.', inputSchema: { type: 'object', properties: {} }, kind: 'hub' },
    ],
})

async function foremanWithBrief() {
    return { ...(await getAgent(FOREMAN_AGENT_ID)), brief }
}

type Written = { type: string; data: unknown; transient?: boolean }

async function foremanToolSet(writes: Written[] = []) {
    const agent = await foremanWithBrief()
    const writer = { write: (part: Written) => writes.push(part), merge: () => {}, onError: undefined }
    return buildTools({ agent, sessionId: 's1', logger, provider: 'rerun', model: 'rerun-max', writer: writer as never })
}

function run(tool: unknown, input: unknown) {
    return (tool as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute(input, { toolCallId: 'call-1', messages: [] })
}

describe('foreman', () => {
    beforeAll(async () => {
        await migrate()
        await ensureForeman()
    })

    beforeEach(() => {
        hubCalls.length = 0
    })

    it('is written as a foreman and stays out of the agent index', async () => {
        await ensureForeman()
        const foreman = await getAgent(FOREMAN_AGENT_ID)
        expect(foreman.config.kind).toBe('foreman')
        expect(foreman.config.model).toBeNull()
        expect(foreman.config.selfImprovement.enabled).toBe(false)
        expect((await listAgentIndex()).map(agent => agent.id)).not.toContain(FOREMAN_AGENT_ID)
    })

    it('works on the box like an agent and on the account through its brief', async () => {
        const { tools, close } = await foremanToolSet()
        const names = Object.keys(tools)
        await close()
        expect(names).toEqual(expect.arrayContaining(['create_agent', 'list_agents', 'focus_agent', 'ask_user', 'request_approval', 'fs_read', 'shared_read', 'shell_exec', 'web_fetch', 'shared_db_query', 'delegate_tasks', 'agent_files_read', 'agent_files_edit']))
    })

    it('keeps the company brain rather than proposing to it', async () => {
        const { tools, close } = await foremanToolSet()
        const names = Object.keys(tools)
        await close()
        expect(names).toEqual(expect.arrayContaining(['brain_search', 'brain_read', 'brain_write', 'brain_delete', 'brain_proposals', 'brain_decide']))
        expect(names).not.toContain('brain_propose')
    })

    it('keeps nothing of its own between conversations', async () => {
        const { tools, close } = await foremanToolSet()
        const names = Object.keys(tools)
        await close()
        for (const name of ['memory_write', 'skill_create', 'schedule_create', 'trigger_create', 'db_query', 'notify_user', 'suggest_service', 'request_secret', 'soul_update', 'install_complete']) expect(names).not.toContain(name)
        expect(names.some(name => name.startsWith('rerun_hub_'))).toBe(false)
    })

    it('shows the files it made, without the table cards', async () => {
        const { tools, close } = await foremanToolSet()
        const names = Object.keys(tools)
        await close()
        expect(names).toContain('card_file')
        for (const name of ['card_table', 'table_view_save', 'table_view_delete']) expect(names).not.toContain(name)
    })

    // The CLI bridge only exposes a tool whose input schema is zod: a JSON Schema passed through as
    // is would leave Claude and Codex with none of the foreman's tools.
    it('hands the CLI bridge zod schemas it can expose', async () => {
        const { tools, close } = await foremanToolSet()
        await close()
        for (const name of ['create_agent', 'list_agents', 'focus_agent']) expect('~standard' in (tools[name].inputSchema as object)).toBe(true)
    })

    it('runs a hub tool on the hub under its own id', async () => {
        const { tools, close } = await foremanToolSet()
        const out = await run(tools.create_agent, { name: 'Scout' })
        await close()
        expect(out).toEqual({ ok: true, tool: 'create_agent' })
        expect(hubCalls).toEqual([{ agentId: FOREMAN_AGENT_ID, tool: 'create_agent', args: { name: 'Scout' } }])
    })

    // Sent transient so the browser applies it once and a reload never replays it.
    it('turns an intent tool into a transient board gesture without calling the hub', async () => {
        const writes: Written[] = []
        const { tools, close } = await foremanToolSet(writes)
        const out = await run(tools.focus_agent, { agentId: 'a1' })
        await close()
        expect(out).toEqual({ ok: true })
        expect(hubCalls).toHaveLength(0)
        expect(writes).toEqual([{ type: FOREMAN_INTENT_PART, data: { tool: 'focus_agent', input: { agentId: 'a1' } }, transient: true }])
    })

    it('has no account tool when the hub sent no brief', async () => {
        const agent = await getAgent(FOREMAN_AGENT_ID)
        const { tools, close } = await buildTools({ agent, sessionId: 's1', logger, provider: 'rerun', model: 'rerun-max' })
        await close()
        const names = Object.keys(tools)
        for (const name of ['create_agent', 'list_agents', 'focus_agent']) expect(names).not.toContain(name)
        expect(names).toContain('ask_user')
    })

    it("reads and edits an agent's files by its handle, inside its workspace only", async () => {
        const scout = await createAgent({ config: { name: 'files-scout' } as never })
        const { tools, close } = await foremanToolSet()
        try {
            expect(await run(tools.agent_files_write, { agent: '@files-scout', path: 'notes/todo.md', content: 'ship it' })).toContain('Wrote')
            expect(await run(tools.agent_files_edit, { agent: 'files-scout', path: 'notes/todo.md', oldString: 'ship', newString: 'test' })).toContain('Edited')
            expect(await run(tools.agent_files_read, { agent: scout.id, path: 'notes/todo.md' })).toBe('test it')
            await expect(run(tools.agent_files_read, { agent: '@files-scout', path: '../.env' })).rejects.toThrow(/escapes the root/)
            await expect(run(tools.agent_files_list, { agent: '@nobody', path: '.' })).rejects.toThrow(/No coworker "@nobody"/)
        } finally {
            await close()
        }
    })

    it('speaks from the brief, with the box around it and none of the agent sections', async () => {
        const prompt = systemPromptText(await buildSystemPrompt(await foremanWithBrief(), { source: 'chat' }, 'claude'))
        expect(prompt).toContain('Charter from the hub.')
        expect(prompt).toContain('<bridged_tools>')
        expect(prompt).toContain('<asking_the_user>')
        expect(prompt).toContain('<showing_files>')
        expect(prompt).toContain('card_file')
        expect(prompt).toContain('<environment>')
        expect(prompt).toContain('agent_files_')
        expect(prompt).toContain('<shared_database>')
        expect(prompt).toContain('<operating_notes>')
        expect(prompt).toContain('<company_brain>')
        expect(prompt).toContain('brain_write the complete new version')
        expect(prompt).not.toContain('You cannot write the brain.')
        expect(prompt).not.toContain('<skills>')
        expect(prompt).not.toContain('<memory_index>')
        expect(prompt).not.toContain('<verbosity>')
    })

    it('never lets an agent be created as a foreman', async () => {
        const agent = await createAgent({ config: { name: 'impostor', kind: 'foreman' } as never })
        expect(agent.config.kind).toBe('user')
    })
})

describe('foreman routes', () => {
    const app = createServer()
    const request = (method: string, path: string, body?: unknown) =>
        app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

    it.each([
        ['PATCH', '/agents/foreman', { description: 'hijacked' }],
        ['PATCH', '/agents/foreman', { model: 'rerun-max', soul: 'hijacked' }],
        ['DELETE', '/agents/foreman', undefined],
        ['POST', '/agents/foreman/duplicate', { name: 'copy' }],
        ['POST', '/agents/foreman/skills/import', {}],
        ['GET', '/agents/foreman/files', undefined],
    ])('refuses %s %s', async (method, path, body) => {
        expect((await request(method, path, body)).status).toBe(403)
    })

    it('lets the hub read the conversations', async () => {
        expect((await request('GET', '/agents/foreman/sessions')).status).toBe(200)
    })

    it('lets the hub pin its model, and keeps the pin across a reboot', async () => {
        const pin = { connectionId: 'rerun', provider: 'rerun', model: 'rerun-max' }
        expect((await request('PATCH', '/agents/foreman', pin)).status).toBe(200)
        const read = await request('GET', '/agents/foreman')
        expect(read.status).toBe(200)
        expect(((await read.json()) as { config: typeof pin }).config).toMatchObject(pin)

        await ensureForeman()
        const foreman = await getAgent(FOREMAN_AGENT_ID)
        expect(foreman.config).toMatchObject({ ...pin, kind: 'foreman', displayName: 'Chief of Staff' })

        expect((await request('PATCH', '/agents/foreman', { connectionId: null, provider: null, model: null })).status).toBe(200)
        expect((await getAgent(FOREMAN_AGENT_ID)).config.model).toBeNull()
    })

    it('leaves the other agents alone', async () => {
        expect((await request('GET', '/agents/not-the-foreman')).status).not.toBe(403)
    })
})
