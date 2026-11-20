import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-delegate-'))
process.env.RERUN_API_KEY = ''

type Child = { id: string; config: any; soul: string; env: Record<string, string> }
type Script = { text?: string; error?: string; throws?: string; gate?: Promise<void>; reads?: string; writes?: string }

const runs = vi.hoisted(() => ({
    started: [] as Array<{ child: Child; sessionId: string; prompt: string; cwd: string; read?: string }>,
    script: (_prompt: string): Script => ({ text: 'done' }),
    active: 0,
    maxActive: 0,
}))

vi.mock('../../runtime/loop.js', () => ({
    runAgent: async (child: Child, sessionId: string, prompt: string) => {
        const { agentProcessEnv } = await import('../../agents/process-env.js')
        const { filesystemTools } = await import('./filesystem.js')
        const script = runs.script(prompt)
        const fs = filesystemTools({ agent: child } as any) as any
        const read = script.reads ? String(await fs.fs_read.execute({ path: script.reads }, { toolCallId: 'r', messages: [] })) : undefined
        if (script.writes) await fs.fs_write.execute({ path: script.writes, content: `written by ${child.id}` }, { toolCallId: 'w', messages: [] })
        runs.started.push({ child, sessionId, prompt, cwd: agentProcessEnv(child as any).cwd, read })
        if (script.throws) throw new Error(script.throws)
        runs.active += 1
        runs.maxActive = Math.max(runs.maxActive, runs.active)
        async function* stream() {
            try {
                await script.gate
                if (script.error) yield { type: 'error', error: new Error(script.error) }
                if (script.text) yield { type: 'text-delta', text: script.text }
                yield { type: 'finish-step' }
            } finally {
                runs.active -= 1
            }
        }
        return { runId: `run-${runs.started.length}`, result: { fullStream: stream() }, settled: Promise.resolve() }
    },
}))

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { migrate } = await import('../../db/migrate.js')
const { listAgentIndex } = await import('../../db/repos/agents.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { agentDir, workspaceDir } = await import('../../config/paths.js')
const { delegateTools } = await import('./delegate.js')

type Written = { type: string; id: string; data: { tasks: Array<{ status: string; title: string }> } }

function ctxWith(extra: Record<string, unknown> = {}) {
    const writes: Written[] = []
    const partialResults: Array<{ label: string; text: string }> = []
    const config = agentConfigSchema.parse({ name: 'boss', model: null, tools: { cards: true, askUser: true }, selfImprovement: { enabled: true } })
    const ctx = {
        agent: { id: 'boss', config, soul: 'Boss soul', install: '', env: { API_KEY: 'k' }, resolved: { connection: { id: 'conn-1' } } },
        sessionId: 's',
        logger: { warn() {}, info() {}, error() {}, debug() {} },
        provider: 'openrouter',
        model: 'acme/large',
        writer: { write: (part: Written) => writes.push(part) },
        partialResults,
        ...extra,
    } as any
    return { ctx, writes, partialResults }
}

async function delegate(ctx: any, tasks: Array<Record<string, unknown>>, abortSignal?: AbortSignal): Promise<string> {
    return (await (delegateTools(ctx).delegate_tasks as any).execute({ tasks }, { toolCallId: 'call-1', messages: [], abortSignal })) as string
}

beforeAll(async () => {
    await migrate()
})

beforeEach(() => {
    runs.started.length = 0
    runs.script = () => ({ text: 'done' })
    runs.active = 0
    runs.maxActive = 0
})

describe('delegate_tasks', () => {
    it('runs the child on a locked-down copy of the parent pinned to the running model', async () => {
        const { ctx } = ctxWith()
        await delegate(ctx, [{ task: 'Summarise the report' }])
        const { child } = runs.started[0]
        expect(child.config).toMatchObject({
            name: 'boss delegate',
            ephemeral: true,
            connectionId: 'conn-1',
            provider: 'openrouter',
            model: 'acme/large',
            tools: { delegate: false, cards: false, askUser: false, requestApproval: false, suggestService: false, requestSecret: false, hub: false, trigger: false, schedule: false, callAgent: false, notify: false, paidData: false, shell: true, web: true, brain: true },
            selfImprovement: { enabled: false },
        })
        expect(child.soul).toBe('Boss soul')
        expect(child.env).toEqual({ API_KEY: 'k' })
        expect(ctx.agent.config.tools.delegate).toBe(true)
        expect(ctx.agent.config.selfImprovement.enabled).toBe(true)
    })

    it('runs the child in the workspace of its caller, so a path its task names is the caller\'s file', async () => {
        const { ctx } = ctxWith()
        mkdirSync(resolve(workspaceDir('boss'), 'docs/contracts'), { recursive: true })
        writeFileSync(resolve(workspaceDir('boss'), 'docs/contracts/BUILD-V2.md'), '# contracts')
        runs.script = () => ({ text: 'done', reads: 'docs/contracts/BUILD-V2.md' })
        await delegate(ctx, [{ task: 'Read docs/contracts/BUILD-V2.md first, then implement packages/brain' }])
        expect(runs.started[0].cwd).toBe(workspaceDir('boss'))
        expect(runs.started[0].read).toContain('# contracts')
    })

    it('leaves what the child wrote with its caller, and deletes only the child', async () => {
        const { ctx } = ctxWith()
        mkdirSync(workspaceDir('boss'), { recursive: true })
        writeFileSync(resolve(workspaceDir('boss'), 'notes.md'), 'kept')
        runs.script = () => ({ text: 'done', writes: 'packages/brain/index.ts' })
        await delegate(ctx, [{ task: 'Implement packages/brain' }])
        const { child } = runs.started[0]
        expect(readFileSync(resolve(workspaceDir('boss'), 'packages/brain/index.ts'), 'utf8')).toBe(`written by ${child.id}`)
        expect(readFileSync(resolve(workspaceDir('boss'), 'notes.md'), 'utf8')).toBe('kept')
        expect(existsSync(agentDir(child.id))).toBe(false)
        expect(workspaceDir(child.id)).toBe(resolve(agentDir(child.id), 'workspace'))
    })

    it('gives the caller its workspace back when the child fails to start', async () => {
        const { ctx } = ctxWith()
        mkdirSync(workspaceDir('boss'), { recursive: true })
        writeFileSync(resolve(workspaceDir('boss'), 'notes.md'), 'kept')
        runs.script = () => ({ throws: 'no model' })
        await delegate(ctx, [{ task: 't' }])
        const { child, cwd } = runs.started[0]
        expect(cwd).toBe(workspaceDir('boss'))
        expect(workspaceDir(child.id)).toBe(resolve(agentDir(child.id), 'workspace'))
        expect(await listAgentIndex()).toEqual([])
        expect(readFileSync(resolve(workspaceDir('boss'), 'notes.md'), 'utf8')).toBe('kept')
    })

    it('puts every parallel child in that same workspace', async () => {
        const { ctx } = ctxWith()
        runs.script = prompt => ({ text: 'done', writes: `${prompt}/out.md` })
        await delegate(ctx, [{ task: 'a' }, { task: 'b' }, { task: 'c' }])
        expect(new Set(runs.started.map(run => run.cwd))).toEqual(new Set([workspaceDir('boss')]))
        for (const name of ['a', 'b', 'c']) expect(existsSync(resolve(workspaceDir('boss'), name, 'out.md'))).toBe(true)
    })

    it('tells the caller its sub-coworkers work on its own files', () => {
        const { ctx } = ctxWith()
        const { description } = delegateTools(ctx).delegate_tasks as { description: string }
        expect(description).toContain('works in your workspace on the same files as you')
        expect(description).not.toContain('shared space')
    })

    it('makes the hub know the child as the coworker that delegated', async () => {
        const { ctx } = ctxWith()
        await delegate(ctx, [{ task: 't' }])
        const { child } = runs.started[0] as { child: Child & { hubAgentId?: string } }
        expect(child.id).not.toBe('boss')
        expect(child.hubAgentId).toBe('boss')
    })

    it('keeps paid data for the child only where the user waived the asking', async () => {
        const { ctx } = ctxWith()
        ctx.agent.config.paidDataAlwaysAllow = true
        await delegate(ctx, [{ task: 't' }])
        expect(runs.started[0].child.config.tools.paidData).toBe(true)
    })

    it('pins no connection when the parent resolved none', async () => {
        const { ctx } = ctxWith()
        ctx.agent.resolved = {}
        await delegate(ctx, [{ task: 't' }])
        expect(runs.started[0].child.config.connectionId).toBeNull()
    })

    it('runs the child at the effort of the turn that started it', async () => {
        const { ctx } = ctxWith({ effort: 'high' })
        await delegate(ctx, [{ task: 't' }])
        expect(runs.started[0].child.config.effort).toBe('high')
    })

    it('leaves out the parent\'s saved effort when the turn runs without one', async () => {
        const { ctx } = ctxWith()
        ctx.agent.config.effort = 'high'
        await delegate(ctx, [{ task: 't' }])
        expect(runs.started[0].child.config.effort).toBeNull()
    })

    it('puts the context above the task behind a separator', async () => {
        const { ctx } = ctxWith()
        await delegate(ctx, [{ task: 'Do A', context: 'Background' }, { task: 'Do B' }])
        expect(runs.started.map(r => r.prompt).sort()).toEqual(['Background\n\n---\n\nDo A', 'Do B'])
    })

    it('returns one section per task, in the order given, whatever order they finish in', async () => {
        let releaseFirst!: () => void
        const firstGate = new Promise<void>(resolve => (releaseFirst = resolve))
        runs.script = prompt => (prompt === 'slow' ? { text: 'slow answer', gate: firstGate } : { text: `${prompt} answer` })
        const { ctx } = ctxWith()
        const pending = delegate(ctx, [{ task: 'slow', title: 'First' }, { task: 'fast' }])
        await vi.waitFor(() => expect(runs.started).toHaveLength(2))
        releaseFirst()
        expect(await pending).toBe('## Task 1 — First\nslow answer\n\n## Task 2 — fast\nfast answer')
    })

    it('never runs more than four children at once', async () => {
        let release!: () => void
        const gate = new Promise<void>(resolve => (release = resolve))
        runs.script = () => ({ text: 'ok', gate })
        const { ctx } = ctxWith()
        const pending = delegate(ctx, Array.from({ length: 7 }, (_, i) => ({ task: `task ${i}` })))
        await vi.waitFor(() => expect(runs.started).toHaveLength(4))
        expect(runs.active).toBe(4)
        release()
        await pending
        expect(runs.started).toHaveLength(7)
        expect(runs.maxActive).toBe(4)
    })

    it('turns a child that throws into an error line and keeps going', async () => {
        runs.script = prompt => (prompt === 'bad' ? { throws: 'model exploded' } : { text: 'fine' })
        const { ctx, writes } = ctxWith()
        const out = await delegate(ctx, [{ task: 'bad' }, { task: 'good' }])
        expect(out).toBe('## Task 1 — bad\n(error: model exploded)\n\n## Task 2 — good\nfine')
        expect(writes.at(-1)?.data.tasks.map(t => t.status)).toEqual(['error', 'done'])
    })

    it('reports a child whose stream failed without any text as stopped', async () => {
        runs.script = () => ({ error: 'provider 500' })
        const { ctx, partialResults } = ctxWith()
        expect(await delegate(ctx, [{ task: 'x' }])).toBe('## Task 1 — x\n(stopped: provider 500)')
        expect(partialResults).toEqual([])
    })

    it('starts nothing when the calling run is already stopped', async () => {
        const parent = new AbortController()
        parent.abort()
        const { ctx } = ctxWith({ abortSignal: parent.signal })
        expect(await delegate(ctx, [{ task: 'a' }, { task: 'b' }])).toBe(
            '## Task 1 — a\n(not started: the calling run was stopped)\n\n## Task 2 — b\n(not started: the calling run was stopped)',
        )
        expect(runs.started).toHaveLength(0)
    })

    it('falls back on the tool call signal when the run has none', async () => {
        const call = new AbortController()
        call.abort()
        const { ctx } = ctxWith()
        expect(await delegate(ctx, [{ task: 'a' }], call.signal)).toContain('(not started')
    })

    it('deletes every child, whether it succeeded or failed', async () => {
        runs.script = prompt => (prompt === 'bad' ? { throws: 'boom' } : { text: 'ok' })
        const { ctx } = ctxWith()
        await delegate(ctx, [{ task: 'bad' }, { task: 'good' }])
        const ids = runs.started.map(r => r.child.id)
        expect(ids).toHaveLength(2)
        for (const id of ids) expect(existsSync(agentDir(id))).toBe(false)
        const indexed = (await listAgentIndex()).map(a => a.id)
        for (const id of ids) expect(indexed).not.toContain(id)
    })

    it('keeps the answers of finished tasks as partial results', async () => {
        runs.script = prompt => (prompt === 'bad' ? { throws: 'boom' } : { text: `${prompt}!` })
        const { ctx, partialResults } = ctxWith()
        await delegate(ctx, [{ task: 'one', title: 'Uno' }, { task: 'bad' }, { task: 'three' }])
        expect(partialResults.sort((a, b) => a.label.localeCompare(b.label))).toEqual([
            { label: 'Task 1 — Uno', text: 'one!' },
            { label: 'Task 3 — three', text: 'three!' },
        ])
    })

    it('streams the progress of every task under the tool call id', async () => {
        const { ctx, writes } = ctxWith()
        await delegate(ctx, [{ task: 'a'.repeat(100) }])
        expect(writes.every(w => w.type === 'data-delegate' && w.id === 'call-1')).toBe(true)
        expect(writes[0].data.tasks).toEqual([expect.objectContaining({ status: 'queued', title: 'a'.repeat(60) })])
        expect(writes.at(-1)?.data.tasks[0].status).toBe('done')
    })

    it('says so when a child returns no text', async () => {
        runs.script = () => ({})
        const { ctx } = ctxWith()
        expect(await delegate(ctx, [{ task: 'quiet' }])).toBe('## Task 1 — quiet\n(the sub-coworker returned no text)')
    })
})
