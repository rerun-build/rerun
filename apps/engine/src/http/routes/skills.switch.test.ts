import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-skills-switch-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { readFile } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { createAgent } = await import('../../agents/factory.js')
const { duplicateAgent } = await import('../../agents/duplicate.js')
const { setSkillEnabled } = await import('../../skills/switch.js')
const { configPath } = await import('../../config/paths.js')
const { skillsListSchema } = await import('@moldwright/contracts')
const { getAgent } = await import('../../agents/registry.js')
const { buildSkillIndex } = await import('../../skills/index.js')

const { migrate } = await import('../../db/migrate.js')
const app = createServer()
let id = ''
let base = ''

type Listed = { slug: string; enabled: boolean }

function send(method: string, path: string, body?: unknown, root = base) {
    return app.request(`${root}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}
const bytes = (agent = id) => readFile(configPath(agent), 'utf8')
const list = async (query = '', root = base) => ((await (await send('GET', query, undefined, root)).json()) as { skills: Listed[] }).skills
const put = (slug: string, body: unknown, root = base) => send('PUT', `/${slug}/enabled`, body, root)

beforeAll(async () => {
    await migrate()
    id = (await createAgent({ config: { name: 'switch' } })).id
    base = `/agents/${id}/skills`
    await send('POST', '', { name: 'Alpha', body: 'a' })
    await send('POST', '', { name: 'Beta', body: 'b' })
})

describe('skill switch', () => {
    it('turning off and on again leaves the config bytes as they were', async () => {
        const first = await bytes()
        expect((await put('alpha', { enabled: false })).status).toBe(200)
        expect((await put('alpha', { enabled: true })).status).toBe(200)
        expect(await bytes()).toBe(first)
    })

    it('keeps both changes when two switches are set at the same time', async () => {
        const other = (await createAgent({ config: { name: 'switch-race' } })).id
        const root = `/agents/${other}/skills`
        await send('POST', '', { name: 'Gamma', body: 'g' }, root)
        await send('POST', '', { name: 'Delta', body: 'd' }, root)
        await Promise.all([setSkillEnabled(other, 'gamma', false), setSkillEnabled(other, 'delta', false)])
        expect(JSON.parse(await bytes(other)).disabledSkills).toEqual(['delta', 'gamma'])
    })

    it('shows the flag in both lists and stores the slug once', async () => {
        const res = await put('alpha', { enabled: false })
        expect(await res.json()).toEqual({ slug: 'alpha', enabled: false })
        const after = await bytes()
        const expected = [
            { slug: 'alpha', enabled: false },
            { slug: 'beta', enabled: true },
        ]
        expect((await list()).map(({ slug, enabled }) => ({ slug, enabled }))).toEqual(expected)
        expect((await list('?summary=1')).map(({ slug, enabled }) => ({ slug, enabled }))).toEqual(expected)
        expect(JSON.parse(after).disabledSkills).toEqual(['alpha'])
        expect(await (await put('alpha', { enabled: false })).json()).toEqual({ slug: 'alpha', enabled: false })
        expect(await bytes()).toBe(after)
    })

    it('refuses unknown skill, unknown coworker and extra keys', async () => {
        expect((await put('nope', { enabled: false })).status).toBe(404)
        expect((await put('alpha', { enabled: false }, '/agents/missing/skills')).status).toBe(404)
        expect((await put('alpha', { enabled: false, extra: 1 })).status).toBe(400)
    })

    it('keeps a skill off when it is replaced through import', async () => {
        const res = await send('POST', '/import', { content: '# new body', name: 'Alpha', slug: 'alpha', overwrite: true })
        expect(res.status).toBe(200)
        expect((await list()).find(s => s.slug === 'alpha')?.enabled).toBe(false)
    })

    it('copies the switch with duplicateAgent', async () => {
        const copy = await duplicateAgent(id, { name: 'switch copy' })
        const root = `/agents/${copy.id}/skills`
        expect((await list('', root)).map(s => s.enabled)).toEqual([false, true])
    })

    it('forgets the slug when the skill is deleted', async () => {
        expect((await send('DELETE', '/alpha')).status).toBe(204)
        expect(JSON.parse(await bytes())).not.toHaveProperty('disabledSkills')
    })

    it('reads every skill as on when the answer has no enabled field', () => {
        const parsed = skillsListSchema.parse({ skills: [{ slug: 'a', name: 'A' }] })
        expect(parsed.skills[0]!.enabled).toBe(true)
    })

    it('a coworker that is already loaded is not offered a skill switched off', async () => {
        const other = (await createAgent({ config: { name: 'switch-loaded' } })).id
        const root = `/agents/${other}/skills`
        await send('POST', '', { name: 'Omega', body: 'o' }, root)
        await send('POST', '', { name: 'Sigma', body: 's' }, root)
        await getAgent(other)
        expect((await put('omega', { enabled: false }, root)).status).toBe(200)
        const off = (await getAgent(other)).config
        expect(off.disabledSkills).toContain('omega')
        const indexOff = await buildSkillIndex(other, off)
        expect(indexOff).toContain('Sigma')
        expect(indexOff).not.toContain('Omega')
        expect((await put('omega', { enabled: true }, root)).status).toBe(200)
        expect(await buildSkillIndex(other, (await getAgent(other)).config)).toContain('Omega')
    })
})
