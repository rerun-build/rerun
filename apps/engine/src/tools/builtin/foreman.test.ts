import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-foreman-tools-'))
process.env.RERUN_API_KEY = ''

type HubCall = { agentId: string; hubToken?: string; tool: string; args: Record<string, unknown>; timeoutMs?: number }

const hub = vi.hoisted(() => ({
    calls: [] as HubCall[],
    log: [] as string[],
    gates: new Map<string, Promise<void>>(),
    failures: new Set<string>(),
}))

vi.mock('../../runtime/hub.js', () => ({
    callHub: async (caller: { id: string; brief?: { hubToken?: string } }, tool: string, args: Record<string, unknown>, timeoutMs?: number) => {
        hub.calls.push({ agentId: caller.id, hubToken: caller.brief?.hubToken, tool, args, timeoutMs })
        const label = String(args.label ?? tool)
        hub.log.push(`start ${label}`)
        await hub.gates.get(label)
        hub.log.push(`end ${label}`)
        if (hub.failures.has(label)) throw new Error(`${label} failed`)
        return { ok: true, label }
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { FOREMAN_INTENT_PART } = await import('@moldwright/contracts')
const { foremanTools } = await import('./foreman.js')

type Spec = { name: string; description?: string; inputSchema?: Record<string, unknown>; kind?: 'hub' | 'intent'; serial?: boolean }

const objectSchema = { type: 'object', properties: { label: { type: 'string' } } }

function ctxWith(specs: Spec[] | undefined, writer?: { write: (part: unknown) => void }) {
    const warnings: unknown[] = []
    const brief = specs && { instructions: 'x', tools: specs.map(s => ({ description: `${s.name} tool`, inputSchema: objectSchema, kind: 'hub', serial: false, ...s })) }
    const ctx = { agent: { id: 'foreman', brief }, sessionId: 's', logger: { warn: (...args: unknown[]) => warnings.push(args) }, writer } as any
    return { ctx, warnings }
}

function deferred() {
    let release!: () => void
    const promise = new Promise<void>(resolve => (release = resolve))
    return { promise, release }
}

function run(tool: unknown, input: unknown) {
    return (tool as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute(input, { toolCallId: 'c', messages: [] })
}

beforeEach(() => {
    hub.calls.length = 0
    hub.log.length = 0
    hub.gates.clear()
    hub.failures.clear()
})

describe('foremanTools', () => {
    it('has no tool without a brief', () => {
        expect(foremanTools(ctxWith(undefined).ctx)).toEqual({})
    })

    it('never shadows a human-in-the-loop builtin', () => {
        const tools = foremanTools(ctxWith([{ name: 'ask_user' }, { name: 'request_approval' }, { name: 'suggest_service' }, { name: 'request_secret' }, { name: 'list_agents' }]).ctx)
        expect(Object.keys(tools)).toEqual(['list_agents'])
    })

    it('drops a tool whose schema zod cannot read and warns about it, keeping the others', () => {
        const { ctx, warnings } = ctxWith([{ name: 'broken', inputSchema: { type: 'nonsense' } }, { name: 'list_agents' }])
        expect(Object.keys(foremanTools(ctx))).toEqual(['list_agents'])
        expect(warnings).toEqual([[expect.objectContaining({ tool: 'broken' }), 'foreman tool schema rejected']])
    })

    it('calls the hub under the agent id with the long timeout and an empty object for missing args', async () => {
        const tools = foremanTools(ctxWith([{ name: 'list_agents', description: 'List them' }]).ctx)
        expect(tools.list_agents.description).toBe('List them')
        expect(await run(tools.list_agents, undefined)).toEqual({ ok: true, label: 'list_agents' })
        expect(hub.calls).toEqual([{ agentId: 'foreman', tool: 'list_agents', args: {}, timeoutMs: 180_000 }])
    })

    it('hands the hub the token of its brief', async () => {
        const { ctx } = ctxWith([{ name: 'list_agents' }])
        ctx.agent.brief.hubToken = 'signed-by-hub'
        await run(foremanTools(ctx).list_agents, {})
        expect(hub.calls).toEqual([expect.objectContaining({ agentId: 'foreman', hubToken: 'signed-by-hub', tool: 'list_agents' })])
    })

    it('runs serial tools one after the other, even across tools', async () => {
        const tools = foremanTools(ctxWith([{ name: 'create_agent', serial: true }, { name: 'create_box', serial: true }]).ctx)
        const first = deferred()
        hub.gates.set('one', first.promise)
        const one = run(tools.create_agent, { label: 'one' })
        const two = run(tools.create_box, { label: 'two' })
        await vi.waitFor(() => expect(hub.log).toEqual(['start one']))
        first.release()
        await Promise.all([one, two])
        expect(hub.log).toEqual(['start one', 'end one', 'start two', 'end two'])
    })

    it('keeps the serial queue moving after a failure', async () => {
        const tools = foremanTools(ctxWith([{ name: 'create_agent', serial: true }]).ctx)
        hub.failures.add('bad')
        const bad = run(tools.create_agent, { label: 'bad' })
        const good = run(tools.create_agent, { label: 'good' })
        await expect(bad).rejects.toThrow('bad failed')
        expect(await good).toEqual({ ok: true, label: 'good' })
    })

    it('lets non-serial tools overlap', async () => {
        const tools = foremanTools(ctxWith([{ name: 'list_agents' }]).ctx)
        const slow = deferred()
        hub.gates.set('slow', slow.promise)
        const a = run(tools.list_agents, { label: 'slow' })
        const b = run(tools.list_agents, { label: 'quick' })
        await b
        expect(hub.log).toEqual(['start slow', 'start quick', 'end quick'])
        slow.release()
        await a
    })

    it('answers an intent with an error when no browser is watching', async () => {
        const tools = foremanTools(ctxWith([{ name: 'focus_agent', kind: 'intent' }]).ctx)
        expect(await run(tools.focus_agent, { label: 'a1' })).toEqual({ ok: false, error: 'No browser is watching this conversation.' })
        expect(hub.calls).toHaveLength(0)
    })

    it('sends an intent to the browser as a transient part', async () => {
        const writes: unknown[] = []
        const tools = foremanTools(ctxWith([{ name: 'focus_agent', kind: 'intent' }], { write: part => writes.push(part) }).ctx)
        expect(await run(tools.focus_agent, { label: 'a1' })).toEqual({ ok: true })
        expect(writes).toEqual([{ type: FOREMAN_INTENT_PART, data: { tool: 'focus_agent', input: { label: 'a1' } }, transient: true }])
    })
})
