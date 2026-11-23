import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-brain-skills-routes-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir, writeFile } = await import('node:fs/promises')
const { existsSync } = await import('node:fs')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir, skillDir } = await import('../../config/paths.js')
const { buildSkillIndex } = await import('../../skills/index.js')

const app = createServer()
const sales = 'sales'
const support = 'support'

type BrainSkill = { slug: string; name: string; description: string; body: string; files: string[]; author: string | null; addedAt: string; updatedAt: string }

function send(method: string, path: string, body?: unknown) {
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function brainSlugs(): Promise<string[]> {
    return ((await (await send('GET', '/brain/skills')).json()) as { skills: BrainSkill[] }).skills.map(s => s.slug)
}

async function summaries(agentId: string): Promise<string[]> {
    return ((await (await send('GET', `/agents/${agentId}/skills?summary=1`)).json()) as { skills: { slug: string }[] }).skills.map(s => s.slug)
}

beforeAll(async () => {
    for (const id of [sales, support]) {
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: id }))
    }
})

describe('Brain skill routes', () => {
    it('starts empty', async () => {
        expect(await brainSlugs()).toEqual([])
    })

    it('creates a skill with its author and dates', async () => {
        const res = await send('POST', '/brain/skills', { name: 'Brand voice', description: 'Write like Acme', body: 'Short sentences.', author: 'user:ada@acme.test' })
        expect(res.status).toBe(201)
        const skill = (await res.json()) as BrainSkill
        expect(skill).toMatchObject({ slug: 'brand-voice', name: 'Brand voice', description: 'Write like Acme', body: 'Short sentences.', files: [], author: 'user:ada@acme.test' })
        expect(Date.parse(skill.addedAt)).not.toBeNaN()
        expect(Date.parse(skill.updatedAt)).not.toBeNaN()
    })

    it('refuses a second skill under the same name, and one without a body', async () => {
        expect((await send('POST', '/brain/skills', { name: 'Brand voice', body: 'Again.', author: 'user:ada@acme.test' })).status).toBe(409)
        expect((await send('POST', '/brain/skills', { name: 'Empty', body: '  ', author: 'user:ada@acme.test' })).status).toBe(400)
    })

    it('takes a name slugify cannot spell, once', async () => {
        const res = await send('POST', '/brain/skills', { name: '週次レポート', body: 'Steps.', author: 'user:ada@acme.test' })
        expect(res.status).toBe(201)
        const skill = (await res.json()) as BrainSkill
        expect(skill.name).toBe('週次レポート')
        expect(skill.slug).toMatch(/^skill-[0-9a-z]{8}$/)
        expect((await send('POST', '/brain/skills', { name: '週次レポート', body: 'Again.', author: 'user:ada@acme.test' })).status).toBe(409)
        expect((await send('DELETE', `/brain/skills/${skill.slug}`)).status).toBe(204)
    })

    it('edits the description and the body, keeping the name and the author', async () => {
        const res = await send('PATCH', '/brain/skills/brand-voice', { body: 'One idea per sentence.' })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ name: 'Brand voice', description: 'Write like Acme', body: 'One idea per sentence.', author: 'user:ada@acme.test' })
    })

    it('is offered to every coworker, behind a skill of its own under the same slug', async () => {
        await send('POST', `/agents/${support}/skills`, { name: 'Brand voice', body: 'Support version.' })
        expect(await summaries(sales)).toEqual(['brand-voice'])
        expect(await summaries(support)).toEqual(['brand-voice'])
        expect(((await (await send('GET', `/agents/${support}/skills/brand-voice`)).json()) as BrainSkill).body).toBe('Support version.')
        expect(await buildSkillIndex(sales)).toContain('- Brand voice (slug: brand-voice): Write like Acme [shared from the Brain]')
        expect(await buildSkillIndex(support)).not.toContain('[shared from the Brain]')
        expect(((await (await send('GET', `/agents/${sales}/skills`)).json()) as { skills: unknown[] }).skills).toEqual([])
    })

    it('moves a coworker skill into the Brain with its files', async () => {
        await send('POST', `/agents/${sales}/skills`, { name: 'Discovery call', description: 'Six questions', body: 'Ask the six questions.' })
        await mkdir(resolve(skillDir(sales, 'discovery-call'), 'references'), { recursive: true })
        await writeFile(resolve(skillDir(sales, 'discovery-call'), 'references', 'questions.md'), '1. Why now?', 'utf8')

        const res = await send('POST', '/brain/skills/share', { agentId: sales, slug: 'discovery-call', author: 'agent:sales' })
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({ slug: 'discovery-call', body: 'Ask the six questions.', files: ['references/questions.md'], author: 'agent:sales' })
        expect(existsSync(skillDir(sales, 'discovery-call'))).toBe(false)
        expect(await brainSlugs()).toEqual(['brand-voice', 'discovery-call'])
        expect(await summaries(support)).toEqual(['brand-voice', 'discovery-call'])
    })

    it('refuses to share a skill already in the Brain, a missing one, or one of an unknown coworker', async () => {
        expect((await send('POST', '/brain/skills/share', { agentId: support, slug: 'brand-voice', author: 'agent:support' })).status).toBe(409)
        expect(((await (await send('GET', `/agents/${support}/skills/brand-voice`)).json()) as BrainSkill).body).toBe('Support version.')
        expect((await send('POST', '/brain/skills/share', { agentId: sales, slug: 'nope', author: 'agent:sales' })).status).toBe(404)
        expect((await send('POST', '/brain/skills/share', { agentId: 'ghost', slug: 'brand-voice', author: 'agent:ghost' })).status).toBe(404)
    })

    it('deletes a skill for every coworker', async () => {
        expect((await send('DELETE', '/brain/skills/discovery-call')).status).toBe(204)
        expect(await brainSlugs()).toEqual(['brand-voice'])
        expect(await summaries(sales)).toEqual(['brand-voice'])
        expect((await send('GET', '/brain/skills/discovery-call')).status).toBe(404)
        expect((await send('DELETE', '/brain/skills/discovery-call')).status).toBe(404)
    })
})
