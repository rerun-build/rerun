import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-proposal-routes-'))
process.env.RERUN_API_KEY = ''

const applied: string[] = []
const picks = new Map<string, unknown>()
vi.mock('../../skills/apply-proposal.js', () => ({
    applySkillProposal: async (_agent: unknown, row: { id: string }, picked?: unknown) => {
        applied.push(row.id)
        picks.set(row.id, picked)
    },
}))

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { insertSkillProposal, getSkillProposal } = await import('../../db/repos/skill-proposals.js')

const id = 'routeagent'
const app = createServer()

let seq = 0
async function proposal() {
    seq += 1
    return insertSkillProposal(id, {
        sessionId: 'session-1',
        runId: null,
        toolCallId: `call-${seq}`,
        mode: 'create',
        slug: null,
        title: 'Publishing checklist',
        summary: 'Always end a post with a CTA',
        instruction: 'Every post ends with a call to action.',
        fingerprint: `fp-${seq}`,
    })
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'route agent' }))
})

describe('skill proposal routes', () => {
    it('lists the proposals of one conversation', async () => {
        const row = await proposal()
        const res = await app.request(`/agents/${id}/skill-proposals?session=session-1`)
        expect(res.status).toBe(200)
        const { proposals } = (await res.json()) as { proposals: { id: string; instructions: string[] }[] }
        expect(proposals.some(p => p.id === row.id)).toBe(true)
        expect(proposals[0].instructions).toEqual(['Every post ends with a call to action.'])
    })

    it('answers the accept before the writing is done', async () => {
        const row = await proposal()
        const res = await app.request(`/agents/${id}/skill-proposals/${row.id}/accept`, { method: 'POST' })
        expect(res.status).toBe(202)
        expect((await getSkillProposal(id, row.id))?.status).toBe('accepted')
        expect(applied).toContain(row.id)
    })

    it('hands the job the model the conversation is set to', async () => {
        const row = await proposal()
        const picked = { connectionId: 'codex-1', model: 'gpt-5.5' }
        await app.request(`/agents/${id}/skill-proposals/${row.id}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(picked) })
        expect(picks.get(row.id)).toEqual(picked)
    })

    it('runs the job with no model when the click carries none', async () => {
        const row = await proposal()
        await app.request(`/agents/${id}/skill-proposals/${row.id}/accept`, { method: 'POST' })
        expect(picks.get(row.id)).toBeUndefined()
    })

    it('runs the job once however many times the row is clicked', async () => {
        const row = await proposal()
        await app.request(`/agents/${id}/skill-proposals/${row.id}/accept`, { method: 'POST' })
        const second = await app.request(`/agents/${id}/skill-proposals/${row.id}/accept`, { method: 'POST' })
        expect(second.status).toBe(200)
        expect(applied.filter(pid => pid === row.id)).toHaveLength(1)
    })

    it('dismisses without touching the job', async () => {
        const row = await proposal()
        const res = await app.request(`/agents/${id}/skill-proposals/${row.id}/dismiss`, { method: 'POST' })
        expect(res.status).toBe(200)
        expect((await getSkillProposal(id, row.id))?.status).toBe('dismissed')
        expect(applied).not.toContain(row.id)
    })
})
