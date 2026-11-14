import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-skills-routes-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')

const id = 'skillroutes'
const app = createServer()
const base = `/agents/${id}/skills`

type Skill = { slug: string; name: string; description: string; body: string; files: string[] }

function send(method: string, path: string, body?: unknown) {
    return app.request(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function slugs(): Promise<string[]> {
    return ((await (await send('GET', '')).json()) as { skills: Skill[] }).skills.map(s => s.slug)
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'skills' }))
})

describe('skill routes', () => {
    it('starts with no skill', async () => {
        expect(await slugs()).toEqual([])
    })

    it('creates a skill with an empty description by default', async () => {
        const res = await send('POST', '', { name: 'Weekly Report', body: 'Collect the numbers, then write.' })
        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({ slug: 'weekly-report', name: 'Weekly Report', description: '', body: 'Collect the numbers, then write.', files: [] })
        expect(await slugs()).toEqual(['weekly-report'])
    })

    it('reads a skill back', async () => {
        const res = await send('GET', '/weekly-report')
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ slug: 'weekly-report', body: 'Collect the numbers, then write.' })
    })

    it('overwrites a skill created twice under the same name', async () => {
        const res = await send('POST', '', { name: 'Weekly Report', description: 'v2', body: 'Second version.' })
        expect(res.status).toBe(201)
        expect(await (await send('GET', '/weekly-report')).json()).toMatchObject({ description: 'v2', body: 'Second version.' })
    })

    it('refuses a skill without a body or a usable name', async () => {
        expect((await send('POST', '', { name: 'No body', body: '' })).status).toBe(400)
        expect((await send('POST', '', { body: 'x' })).status).toBe(400)
        expect((await send('POST', '', { name: '!!!', body: 'x' })).status).toBe(400)
    })

    it('lists only names and descriptions when asked for a summary', async () => {
        const res = await send('GET', '?summary=1')
        expect(await res.json()).toEqual({ skills: [{ slug: 'weekly-report', name: 'Weekly Report', description: 'v2', enabled: true }] })
    })

    it('patches the description and keeps the body', async () => {
        const res = await send('PATCH', '/weekly-report', { description: 'patched' })
        expect(await res.json()).toMatchObject({ description: 'patched', body: 'Second version.' })
    })

    it.each([
        ['GET', '/nope'],
        ['PATCH', '/nope'],
        ['DELETE', '/nope'],
        ['GET', '/nope/archive'],
    ])('%s %s answers 404', async (method, path) => {
        const res = await send(method, path, method === 'PATCH' ? { body: 'x' } : undefined)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'skill not found' })
    })

    it('deletes a skill, then no longer finds it', async () => {
        expect((await send('DELETE', '/weekly-report')).status).toBe(204)
        expect((await send('GET', '/weekly-report')).status).toBe(404)
        expect(await slugs()).toEqual([])
    })

    it.each([
        ['an empty file', '   ', 'File is empty'],
        ['a frontmatter without a name', '---\ndescription: nameless\n---\n\nDo it\n', "Missing 'name' in frontmatter"],
        ['a skill with no body', '---\nname: Hollow\n---\n', 'Skill body is empty'],
    ])('refuses to import %s', async (_, content, error) => {
        const res = await send('POST', '/import', { content })
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error })
    })

    it('404s on the skills of an unknown agent', async () => {
        const res = await app.request('/agents/ghost/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', body: 'y' }) })
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'agent not found' })
    })
})
