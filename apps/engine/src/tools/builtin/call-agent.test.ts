import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { RunContext } from '../../runtime/context.js'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-callagent-'))
process.env.RERUN_DATA_DIR = dataDir

const { describe, expect, it, beforeAll, vi } = await import('vitest')
const { migrate } = await import('../../db/migrate.js')
const { insertAgentIndex, listAgentIndex } = await import('../../db/repos/agents.js')
const { createSession, getSession } = await import('../../db/repos/sessions.js')

type TracedEvent = { event: string; agentId?: string; sessionId?: string | null; title?: string | null; source?: string | null; originAgentId?: string | null; trigger?: unknown }
const traced: TracedEvent[] = []

vi.doMock('../../runtime/notify.js', () => ({
    sendNotification: async (input: TracedEvent) => {
        traced.push(input)
        return { delivered: true }
    },
}))

vi.doMock('../../runtime/headless-run.js', () => ({
    startHeadlessRun: async (_callee: unknown, sessionId: string, _prompt: string, _override: unknown, trigger: unknown) => {
        traced.push({ event: 'run.started', sessionId, trigger })
        return { runId: 'run-1', result: { finishReason: Promise.resolve('stop'), fullStream: (async function* () {})() } }
    },
}))

vi.doMock('../../agents/registry.js', () => ({
    getAgent: async (id: string) => ({ id, config: id === 'foreman' ? { name: 'foreman', kind: 'foreman', enabled: true, tools: { callAgent: true }, selfImprovement: { enabled: false } } : { name: 'Bob', enabled: true, tools: { callAgent: true }, selfImprovement: { enabled: true } } }),
}))

const { resolveTargetAgent, callAgentTools, callTargetsOf, withForeman } = await import('./call-agent.js')
const { getSystemDb } = await import('../../db/systemDb.js')

const agents = () => listAgentIndex()

beforeAll(async () => {
    await migrate()
    await insertAgentIndex('agent-a', 'Alice')
    await insertAgentIndex('agent-b', 'Agent B')
    await insertAgentIndex('agent-c', 'Bob')
    await insertAgentIndex('agent-d', 'Alice delegate')
})

describe('resolveTargetAgent', () => {
    it('resolves by exact id', async () => {
        const all = await agents()
        const result = resolveTargetAgent('agent-c', all)
        expect('agent' in result && result.agent.id).toBe('agent-c')
    })

    it('resolves by case-insensitive name', async () => {
        const all = await agents()
        const result = resolveTargetAgent('bob', all)
        expect('agent' in result && result.agent.id).toBe('agent-c')
    })

    it('rejects an unknown agent name', async () => {
        const all = await agents()
        const result = resolveTargetAgent('ghost', all)
        expect('error' in result && result.error).toContain('not found')
    })

    it('rejects when there are no other agents', () => {
        const result = resolveTargetAgent('Bob', [])
        expect('error' in result && result.error).toContain('no other coworkers')
    })
})

describe('callTargetsOf', () => {
    it('offers every coworker but the caller and the delegates when the hub names nobody', async () => {
        expect(callTargetsOf(await agents(), 'agent-a').map(a => a.id)).toEqual(['agent-b', 'agent-c'])
    })

    it('keeps only the coworkers the person behind the run reaches', async () => {
        expect(callTargetsOf(await agents(), 'agent-a', ['agent-c', 'agent-d']).map(a => a.id)).toEqual(['agent-c'])
    })

    it('offers nobody to someone who reaches no other coworker', async () => {
        expect(callTargetsOf(await agents(), 'agent-a', [])).toEqual([])
    })

    it('offers the Chief of Staff beside the coworkers, by its name or its id, and never to itself', async () => {
        const targets = callTargetsOf(withForeman(await agents()), 'agent-a')
        expect(targets.map(a => a.id)).toEqual(['agent-b', 'agent-c', 'foreman'])
        expect(resolveTargetAgent('Chief of Staff', targets)).toEqual({ agent: expect.objectContaining({ id: 'foreman' }) })
        expect(resolveTargetAgent('foreman', targets)).toEqual({ agent: expect.objectContaining({ id: 'foreman' }) })
        expect(callTargetsOf(withForeman(await agents()), 'foreman').map(a => a.id)).not.toContain('foreman')
    })

    it('keeps the Chief of Staff for someone kept out of every Box only when the hub names it', async () => {
        expect(callTargetsOf(withForeman(await agents()), 'agent-a', ['foreman']).map(a => a.id)).toEqual(['foreman'])
        expect(callTargetsOf(withForeman(await agents()), 'agent-a', ['agent-c']).map(a => a.id)).toEqual(['agent-c'])
    })
})

describe('call_agent for someone kept out of a Box', () => {
    const restricted = async () => ({ agent: { id: 'agent-a', config: { name: 'Alice' } }, sessionId: 'session-1', callTargets: callTargetsOf(await agents(), 'agent-a', ['agent-c']), callableAgentIds: ['agent-c'] }) as unknown as RunContext

    it('never names a coworker they cannot reach', async () => {
        const description = (callAgentTools(await restricted()).call_agent as { description?: string }).description ?? ''
        expect(description).toContain('Bob (id: agent-c)')
        expect(description).not.toContain('agent-b')
    })

    it('refuses to call it, by id or by name, without naming it back', async () => {
        const tools = callAgentTools(await restricted())
        for (const ref of ['agent-b', 'Agent B']) {
            const answer = (await (tools.call_agent as any).execute({ agent: ref, message: 'what is in your files?', wait: true }, {} as any)) as string
            expect(answer).toContain('not found')
            expect(answer).not.toContain('(id: agent-b)')
        }
    })

    it('hands the same reach down to the coworker it calls', async () => {
        traced.length = 0
        const tools = callAgentTools(await restricted())
        await (tools.call_agent as any).execute({ agent: 'agent-c', message: 'hi', wait: false }, {} as any)
        expect(traced.find(e => e.event === 'run.started')?.trigger).toEqual({ source: 'chat', callableAgentIds: ['agent-c'], calledBy: { id: 'agent-a', name: 'Alice', waiting: false } })
    })
})

describe('call_agent tool availability', () => {
    it('exposes call_agent whenever a roster is present', async () => {
        const all = await agents()
        const set = callAgentTools({ callTargets: all } as unknown as RunContext)
        expect('call_agent' in set).toBe(true)
    })
})

describe('sessions origin trace', () => {
    it('creates the callee system db with origin columns', async () => {
        const { client } = await getSystemDb('agent-c')
        const info = await client.execute('PRAGMA table_info(sessions)')
        const columns = info.rows.map(r => String(r.name))
        expect(columns).toContain('origin_agent_id')
        expect(columns).toContain('origin_session_id')
        expect(columns).toContain('source')
    })

    it('stores and returns the origin of a session', async () => {
        const session = await createSession('agent-c', 'from Alice: tell a joke', { originAgentId: 'agent-a', originSessionId: 'session-1' }, 'agent')
        const loaded = await getSession('agent-c', session.id)
        expect(loaded?.originAgentId).toBe('agent-a')
        expect(loaded?.originSessionId).toBe('session-1')
        expect(loaded?.source).toBe('agent')
    })
})

describe('call_agent session mirroring', () => {
    it('announces the callee session to the hub before the run starts', async () => {
        traced.length = 0
        const ctx = { agent: { id: 'agent-a', config: { name: 'Alice' } }, sessionId: 'session-1', callTargets: await agents() } as unknown as RunContext
        const tools = callAgentTools(ctx)
        const answer = (await (tools.call_agent as any).execute({ agent: 'agent-c', message: 'tell a joke', wait: false }, {} as any)) as string

        expect(answer).toContain('dispatched')
        expect(traced.map(e => e.event)).toEqual(['agent.session.created', 'run.started'])

        const created = traced[0]
        expect(created.agentId).toBe('agent-c')
        expect(created.source).toBe('agent')
        expect(created.originAgentId).toBe('agent-a')
        expect(created.title).toBe('from Alice: tell a joke')
        expect(traced[1].sessionId).toBe(created.sessionId)
    })
})

describe('call_agent tells the coworker it calls who is calling', () => {
    it.each([true, false])('names the caller and says whether it waits (%s)', async wait => {
        traced.length = 0
        const ctx = { agent: { id: 'agent-a', config: { name: 'Alice' } }, sessionId: 'session-1', callTargets: await agents() } as unknown as RunContext
        await (callAgentTools(ctx).call_agent as any).execute({ agent: 'agent-c', message: 'delete row 1', wait }, {} as any)
        expect(traced.find(e => e.event === 'run.started')?.trigger).toEqual({ source: 'chat', calledBy: { id: 'agent-a', name: 'Alice', waiting: wait } })
    })
})

describe('call_agent to the Chief of Staff', () => {
    it('names it as the roster does, not by its fixed id', async () => {
        traced.length = 0
        const written: { data: { agentName: string } }[] = []
        const ctx = { agent: { id: 'agent-a', config: { name: 'Alice' } }, sessionId: 'session-1', callTargets: callTargetsOf(withForeman(await agents()), 'agent-a'), writer: { write: (part: { data: { agentName: string } }) => written.push(part) } } as unknown as RunContext
        const answer = (await (callAgentTools(ctx).call_agent as any).execute({ agent: 'foreman', message: 'who handles billing?', wait: false }, { toolCallId: 'call-1' } as any)) as string
        expect(answer).toContain('dispatched to Chief of Staff')
        expect(written.map(part => part.data.agentName)).toEqual(expect.not.arrayContaining(['foreman']))
    })
})

describe('call_agent progress part', () => {
    type Written = { type: string; id?: string; data: { agentName: string; status: string; error?: string } }
    const contextWith = async (written: Written[]) =>
        ({ agent: { id: 'agent-a', config: { name: 'Alice' } }, sessionId: 'session-1', callTargets: await agents(), writer: { write: (part: Written) => written.push(part) } }) as unknown as RunContext

    it('emits before its first await, so parts land in call order', async () => {
        const written: Written[] = []
        const tools = callAgentTools(await contextWith(written))
        const pending = (tools.call_agent as any).execute({ agent: 'agent-c', message: 'hi', wait: false }, { toolCallId: '7' } as any)

        expect(written).toHaveLength(1)
        expect(written[0]).toMatchObject({ type: 'data-call-agent', id: '7', data: { agentName: 'Bob', status: 'running' } })
        await pending
        expect(written.at(-1)?.data.status).toBe('dispatched')
    })

    it('still emits one for a call it refuses', async () => {
        const written: Written[] = []
        const tools = callAgentTools(await contextWith(written))
        const answer = (await (tools.call_agent as any).execute({ agent: 'ghost', message: 'hi', wait: true }, { toolCallId: '8' } as any)) as string

        expect(answer).toContain('not found')
        expect(written.at(-1)).toMatchObject({ id: '8', data: { agentName: 'ghost', status: 'error' } })
        expect(written.at(-1)?.data.error).toContain('not found')
    })
})
