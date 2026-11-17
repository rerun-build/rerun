import { mkdtempSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-apply-proposal-'))
process.env.RERUN_DATA_DIR = dataDir
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.com'
process.env.RERUN_API_KEY = 'hub-key'

const draft = { value: { name: 'Publishing', description: 'How posts go out', body: 'Draft, review, publish.\n\nEvery post ends with a CTA.' } as unknown, fail: false }

vi.mock('../agents/structured.js', () => ({
    generateStructured: async () => {
        if (draft.fail) throw new Error('model is down')
        return draft.value
    },
}))

const calls = { writtenBy: [] as any[], cliAuth: [] as { provider: string; connection: string | undefined }[], codexSync: [] as (string | undefined)[] }

vi.mock('../agents/providers.js', () => ({
    modelFor: (agent: any) => {
        calls.writtenBy.push(agent.resolved)
        return 'test-model'
    },
}))

vi.mock('../connections/cli-auth.js', () => ({
    ensureCliAuth: async (provider: string, connection: any) => {
        calls.cliAuth.push({ provider, connection: connection?.id })
        return () => {}
    },
}))

vi.mock('../connections/codex-auth.js', () => ({
    syncCodexAuth: async (connection: any) => {
        calls.codexSync.push(connection?.id)
    },
}))

const { describe, expect, it, beforeEach } = await import('vitest')
const { applySkillProposal, applyProposalPrompt } = await import('./apply-proposal.js')
const { writeSkillFolder } = await import('./loader.js')
const { SKILL_STYLE } = await import('./style.js')
const { insertSkillProposal, getSkillProposal, transitionSkillProposal } = await import('../db/repos/skill-proposals.js')
const { skillsDir, skillDir, connectionsDir } = await import('../config/paths.js')
const { rm } = await import('node:fs/promises')
const { DEFAULT_CONNECTION_MODELS, CONNECTION_TOKEN_KEY, agentConfigSchema } = await import('@rerun/contracts')
const { createConnection, ensureRerunConnection } = await import('../connections/store.js')
const { resolveConfiguredModel } = await import('../agents/availability.js')

const id = 'applier'
const agent = { id, resolved: { connection: null, provider: 'rerun', model: 'rerun-max' } } as any

let seq = 0
type Pair = { connectionId: string | null; provider: any; model: string }

async function accepted(input: { mode: 'create' | 'edit'; slug: string | null; title: string }, pair?: Pair) {
    seq += 1
    const row = await insertSkillProposal(id, {
        ...(pair ?? {}),
        sessionId: 'session-1',
        runId: null,
        toolCallId: `call-${seq}`,
        mode: input.mode,
        slug: input.slug,
        title: input.title,
        summary: 'Always end a post with a CTA',
        instruction: 'Every post ends with a call to action.',
        fingerprint: `fp-${seq}`,
    })
    await transitionSkillProposal(id, row.id, ['proposed'], 'accepted')
    return (await getSkillProposal(id, row.id))!
}

beforeEach(() => {
    calls.writtenBy = []
    calls.cliAuth = []
    calls.codexSync = []
    draft.fail = false
    draft.value = { name: 'Publishing', description: 'How posts go out', body: 'Draft, review, publish.\n\nEvery post ends with a CTA.' }
})

describe('applySkillProposal', () => {
    it('writes a new skill and marks the proposal applied', async () => {
        draft.value = { name: 'Weekly report', description: 'How the weekly report goes out', body: 'Pull the numbers, write it, send it.' }
        const row = await accepted({ mode: 'create', slug: null, title: 'Weekly report' })

        await applySkillProposal(agent, row)

        const written = await readFile(resolve(skillDir(id, 'weekly-report'), 'SKILL.md'), 'utf8')
        expect(written).toContain('Pull the numbers')
        const after = await getSkillProposal(id, row.id)
        expect(after?.status).toBe('applied')
        expect(after?.appliedSlug).toBe('weekly-report')
    })

    // writeSkill re-slugifies from the name, so a skill whose name drifted from its folder would
    // fork a second one on every edit.
    it('edits in place when the name no longer matches the folder', async () => {
        await writeSkillFolder(id, { slug: 'publishing', name: 'Publishing posts', description: 'How posts go out', body: 'Draft, review, publish.', files: [] })
        const before = readdirSync(skillsDir(id)).length
        draft.value = { name: 'Something else entirely', description: 'How posts go out', body: 'Draft, review, publish.\n\nEvery post ends with a CTA.' }
        const row = await accepted({ mode: 'edit', slug: 'publishing', title: 'Publishing posts' })

        await applySkillProposal(agent, row)

        expect(readdirSync(skillsDir(id)).length).toBe(before)
        const written = await readFile(resolve(skillDir(id, 'publishing'), 'SKILL.md'), 'utf8')
        expect(written).toContain('name: Publishing posts')
        expect(written).toContain('Every post ends with a CTA.')
    })

    it('leaves the skill untouched when the model fails', async () => {
        await writeSkillFolder(id, { slug: 'intact', name: 'Intact', description: 'Untouched', body: 'Original body.', files: [] })
        draft.fail = true
        const row = await accepted({ mode: 'edit', slug: 'intact', title: 'Intact' })

        await applySkillProposal(agent, row)

        expect(await readFile(resolve(skillDir(id, 'intact'), 'SKILL.md'), 'utf8')).toContain('Original body.')
        const after = await getSkillProposal(id, row.id)
        expect(after?.status).toBe('failed')
        expect(after?.error).toBe('model is down')
    })

    it('fails when the target skill was deleted between proposal and click', async () => {
        const row = await accepted({ mode: 'edit', slug: 'gone', title: 'Gone' })

        await applySkillProposal(agent, row)

        const after = await getSkillProposal(id, row.id)
        expect(after?.status).toBe('failed')
        expect(after?.error).toContain('no longer exists')
    })
})

// The agent follows the box default, which is the keyless Rerun connection, while the user chats
// on a subscription picked in the composer: the case where the Rerun budget is spent.
describe('the model the skill is written with', () => {
    beforeEach(async () => {
        await rm(connectionsDir(), { recursive: true, force: true })
    })

    async function rerunAgent() {
        await ensureRerunConnection()
        const config = agentConfigSchema.parse({ name: 'applier', connectionId: null, provider: null, model: null })
        return { id, config, soul: '', install: '', env: {}, resolved: await resolveConfiguredModel(config) } as any
    }

    function subscription(provider: 'claude' | 'codex', token = 'token') {
        return createConnection({ name: provider, provider, models: DEFAULT_CONNECTION_MODELS[provider], extraModels: [], keys: token ? { [CONNECTION_TOKEN_KEY[provider]!]: token } : {} })
    }

    it('writes on the Claude subscription the conversation ran on', async () => {
        const agent = await rerunAgent()
        const claude = await subscription('claude')
        const row = await accepted({ mode: 'create', slug: null, title: 'On Claude' }, { connectionId: claude.id, provider: 'claude', model: 'claude-opus-5-5' })

        await applySkillProposal(agent, row)

        expect(calls.writtenBy[0]).toMatchObject({ provider: 'claude', model: 'claude-opus-5-5' })
        expect(calls.writtenBy[0].connection.id).toBe(claude.id)
        expect(calls.cliAuth).toEqual([{ provider: 'claude', connection: claude.id }])
        expect(calls.codexSync).toEqual([])
        expect((await getSkillProposal(id, row.id))?.status).toBe('applied')
    })

    it('writes on the Codex subscription and syncs its tokens back, even when the draft fails', async () => {
        const agent = await rerunAgent()
        const codex = await subscription('codex')
        const model = DEFAULT_CONNECTION_MODELS.codex[0]
        draft.fail = true
        const row = await accepted({ mode: 'create', slug: null, title: 'On Codex' }, { connectionId: codex.id, provider: 'codex', model })

        await applySkillProposal(agent, row)

        expect(calls.writtenBy[0]).toMatchObject({ provider: 'codex', model })
        expect(calls.cliAuth).toEqual([{ provider: 'codex', connection: codex.id }])
        expect(calls.codexSync).toEqual([codex.id])
        expect((await getSkillProposal(id, row.id))?.status).toBe('failed')
    })

    it("falls back to the agent's own pair when the subscription was signed out since", async () => {
        const agent = await rerunAgent()
        const signedOut = await subscription('claude', '')
        const row = await accepted({ mode: 'create', slug: null, title: 'Signed out' }, { connectionId: signedOut.id, provider: 'claude', model: 'claude-opus-5-5' })

        await applySkillProposal(agent, row)

        expect(calls.writtenBy[0]).toBe(agent.resolved)
    })

    it("falls back to the agent's own pair when the connection is gone", async () => {
        const agent = await rerunAgent()
        const row = await accepted({ mode: 'create', slug: null, title: 'Gone connection' }, { connectionId: 'deleted', provider: 'claude', model: 'claude-opus-5-5' })

        await applySkillProposal(agent, row)

        expect(calls.writtenBy[0]).toBe(agent.resolved)
    })

    it("keeps the agent's own pair for a proposal made before the pair was recorded", async () => {
        const agent = await rerunAgent()
        const row = await accepted({ mode: 'create', slug: null, title: 'Legacy row' })

        await applySkillProposal(agent, row)

        expect(calls.writtenBy[0]).toBe(agent.resolved)
        expect(calls.cliAuth).toEqual([{ provider: 'rerun', connection: agent.resolved.connection.id }])
    })
})

describe('applyProposalPrompt', () => {
    it('hands the model the current body when editing', () => {
        const prompt = applyProposalPrompt({
            title: 'Publishing',
            instructions: ['Every post ends with a CTA.'],
            current: { name: 'Publishing', description: 'How posts go out', body: 'Draft, review, publish.' },
            others: [],
        })
        expect(prompt).toContain('Draft, review, publish.')
        expect(prompt).toContain('Keep the name unchanged')
    })

    it('names the neighbouring skills when creating', () => {
        const prompt = applyProposalPrompt({
            title: 'Weekly report',
            instructions: ['Send it on Friday.'],
            current: null,
            others: [{ slug: 'publishing', name: 'Publishing', description: 'How posts go out' }],
        })
        expect(prompt).toContain('- Publishing: How posts go out')
        expect(prompt).not.toContain('Keep the name unchanged')
    })

    it('asks for a terse skill when creating and when editing', () => {
        const rules = { title: 'Weekly report', instructions: ['Send it on Friday.'], others: [] }
        const creating = applyProposalPrompt({ ...rules, current: null })
        const editing = applyProposalPrompt({ ...rules, current: { name: 'Weekly report', description: 'The Friday report', body: 'Draft, send.' } })
        for (const prompt of [creating, editing]) expect(prompt).toContain(SKILL_STYLE)
        expect(editing).toContain('keep every other line exactly as it is')
    })
})
