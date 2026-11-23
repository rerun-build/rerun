import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
    recalled: [] as { id: string; content: string; kind: string; tags: string[]; createdAt: string; strength: number }[],
    recallFails: false,
    skills: [] as { slug: string; name: string; description: string }[],
    skillsFail: false,
    output: { memory: null, obsoleteIds: [] } as { memory: { content: string; updateId: string | null } | null; obsoleteIds: string[] },
    prompts: [] as string[],
    ops: [] as string[],
    failing: new Set<string>(),
    warnings: [] as string[],
}))

vi.mock('../memory/store.js', () => ({
    recallMemory: async () => {
        if (state.recallFails) throw new Error('index down')
        return state.recalled
    },
    writeMemory: async (_agent: unknown, content: string, kind: string) => {
        state.ops.push(`write ${kind} ${content}`)
        if (state.failing.has('write')) throw new Error('disk full')
    },
    updateMemory: async (_agent: unknown, id: string, content: string) => {
        state.ops.push(`update ${id} ${content}`)
        if (state.failing.has('update')) throw new Error('disk full')
    },
    deleteMemory: async (_agent: unknown, id: string) => {
        state.ops.push(`delete ${id}`)
        if (state.failing.has('delete')) throw new Error('disk full')
    },
}))

vi.mock('../skills/brain.js', () => ({
    listUsableSkillSummaries: async () => {
        if (state.skillsFail) throw new Error('unreadable')
        return state.skills
    },
}))

vi.mock('../agents/providers.js', () => ({ modelFor: () => ({ modelId: 'mock' }) }))
vi.mock('../connections/cli-auth.js', () => ({ ensureCliAuth: async () => () => {} }))

vi.mock('../agents/structured.js', () => ({
    generateStructured: async ({ prompt }: { prompt: string }) => {
        state.prompts.push(prompt)
        return state.output
    },
}))

vi.mock('../lib/logger.js', () => ({ logger: { warn: (_obj: unknown, msg: string) => state.warnings.push(msg), info() {}, error() {}, debug() {} } }))

const { runCurator } = await import('./curator.js')

function agentWith({ autoMemory = true, skills = true } = {}) {
    return { id: 'curated', config: { selfImprovement: { autoMemory }, tools: { skills } }, resolved: { provider: 'claude', model: 'claude-opus-5-5', connection: null } } as any
}

function memory(id: string, content: string) {
    return { id, content, kind: 'learned', tags: [], createdAt: '2026-09-01T00:00:00Z', strength: 1 }
}

beforeEach(() => {
    state.recalled = []
    state.recallFails = false
    state.skills = []
    state.skillsFail = false
    state.output = { memory: null, obsoleteIds: [] }
    state.prompts = []
    state.ops = []
    state.failing.clear()
    state.warnings = []
})

describe('runCurator', () => {
    it('does nothing when auto memory is off', async () => {
        await runCurator(agentWith({ autoMemory: false }), 's', 'I live in Lyon', 'Noted.')
        expect(state.prompts).toEqual([])
        expect(state.ops).toEqual([])
    })

    it('stores a new learned memory', async () => {
        state.output = { memory: { content: 'Lives in Lyon', updateId: null }, obsoleteIds: [] }
        await runCurator(agentWith(), 's', 'I live in Lyon', 'Noted.')
        expect(state.ops).toEqual(['write learned Lives in Lyon'])
        expect(state.prompts[0]).toContain('User: I live in Lyon')
    })

    it('updates a known memory in place and does not also delete it', async () => {
        state.recalled = [memory('mem-1', 'Lives in Paris'), memory('mem-2', 'Works remotely from Paris')]
        state.output = { memory: { content: 'Lives in Lyon', updateId: 'mem-1' }, obsoleteIds: ['mem-1', 'mem-2'] }
        await runCurator(agentWith(), 's', 'I moved to Lyon', 'Noted.')
        expect(state.ops).toEqual(['delete mem-2', 'update mem-1 Lives in Lyon'])
    })

    it('writes a new memory when the update id was never shown to the model', async () => {
        state.recalled = [memory('mem-1', 'Lives in Paris')]
        state.output = { memory: { content: 'Lives in Lyon', updateId: 'invented-id' }, obsoleteIds: ['invented-id'] }
        await runCurator(agentWith(), 's', 'I moved to Lyon', 'Noted.')
        expect(state.ops).toEqual(['write learned Lives in Lyon'])
    })

    it('only deletes obsolete memories it actually recalled', async () => {
        state.recalled = [memory('mem-1', 'Has a cat')]
        state.output = { memory: null, obsoleteIds: ['mem-1', 'mem-999'] }
        await runCurator(agentWith(), 's', 'The cat passed away', 'Sorry to hear.')
        expect(state.ops).toEqual(['delete mem-1'])
    })

    it('still curates when recall and skill listing both fail', async () => {
        state.recallFails = true
        state.skillsFail = true
        state.output = { memory: { content: 'Prefers tea', updateId: null }, obsoleteIds: [] }
        await runCurator(agentWith(), 's', 'I prefer tea', 'Noted.')
        expect(state.ops).toEqual(['write learned Prefers tea'])
        expect(state.prompts[0]).not.toContain('Existing related memories')
        expect(state.prompts[0]).not.toContain('These skills already govern')
    })

    it('does not show skills to the curator when the agent has no skills tool', async () => {
        state.skills = [{ slug: 'weekly-report', name: 'Weekly report', description: 'How the report is written' }]
        await runCurator(agentWith({ skills: false }), 's', 'hi', 'hello')
        expect(state.prompts[0]).not.toContain('Weekly report')

        await runCurator(agentWith({ skills: true }), 's', 'hi', 'hello')
        expect(state.prompts[1]).toContain('- Weekly report (slug: weekly-report): How the report is written')
    })

    it('swallows a failing write, update or delete with a warning', async () => {
        state.failing = new Set(['write', 'update', 'delete'])
        state.recalled = [memory('mem-1', 'a'), memory('mem-2', 'b')]

        state.output = { memory: { content: 'c', updateId: 'mem-1' }, obsoleteIds: ['mem-2'] }
        await expect(runCurator(agentWith(), 's', 'u', 'a')).resolves.toBeUndefined()

        state.output = { memory: { content: 'd', updateId: null }, obsoleteIds: [] }
        await expect(runCurator(agentWith(), 's', 'u', 'a')).resolves.toBeUndefined()

        expect(state.warnings).toEqual(['auto memory delete failed', 'auto memory update failed', 'auto memory failed'])
    })
})
