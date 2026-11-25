import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-search-'))
process.env.RERUN_API_KEY = ''

const { beforeAll, describe, expect, it, vi } = await import('vitest')
const { mkdir, writeFile } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir, brainDir, brainSkillsDir, sharedDir, soulPath, workspaceDir } = await import('../../config/paths.js')
const { writeSkill } = await import('../../skills/loader.js')
const { getAgentDb } = await import('../../db/agentDb.js')
const { getSharedDb } = await import('../../db/sharedDb.js')
const { searchTableRows } = await import('../../db/sqlStore.js')
const { searchWorkspace } = await import('../../search/workspaceSearch.js')
const { snippetAround } = await import('@rerun/contracts')

const app = createServer()

type Hit = { kind: string; agentId?: string | null; [key: string]: unknown }

async function search(query: string): Promise<{ hits: Hit[]; truncated: boolean }> {
    const res = await app.request(`/search?${query}`)
    expect(res.status).toBe(200)
    return (await res.json()) as { hits: Hit[]; truncated: boolean }
}

async function agent(id: string, soul: string) {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: id }))
    await writeFile(soulPath(id), soul)
}

beforeAll(async () => {
    await agent('ada', 'You run the paid side of our socials.\nEvery Monday, Boost the best post of the week.')
    await agent('noor', 'You never boost a post without asking first.')
    await agent('iris', 'You file invoices.')

    await writeSkill('ada', 'boost-top-posts', 'Boost the best posts', 'Pick the 3 best posts and boost them.')
    await writeSkill('iris', 'invoices', 'File invoices', 'Read the inbox.')
    await mkdir(resolve(brainSkillsDir(), 'weekly-report'), { recursive: true })
    await writeFile(resolve(brainSkillsDir(), 'weekly-report', 'SKILL.md'), '---\nname: weekly-report\ndescription: Weekly ads\n---\n\n## Report\nList every boost still running.\n')

    await mkdir(resolve(sharedDir(), 'marketing'), { recursive: true })
    await writeFile(resolve(sharedDir(), 'marketing', 'q4-plan.md'), '## Paid\n\nBoost budget: $400 a month.\n')
    await writeFile(resolve(sharedDir(), 'boost-ideas.txt'), 'nothing inside\n')
    await writeFile(resolve(sharedDir(), '.hidden-boost.md'), 'boost\n')
    await mkdir(resolve(sharedDir(), '.venv', 'lib'), { recursive: true })
    await writeFile(resolve(sharedDir(), '.venv', 'lib', 'boost.py'), 'boost\n')
    await writeFile(resolve(sharedDir(), 'image.bin'), Buffer.from([0x62, 0x6f, 0x6f, 0x73, 0x74, 0x00, 0x01]))
    await writeFile(resolve(sharedDir(), 'huge.txt'), `${'x'.repeat(1024 * 1024)}boost`)
    await mkdir(workspaceDir('ada'), { recursive: true })
    await writeFile(resolve(workspaceDir('ada'), 'ideas.md'), '- Reply fast\n- Try a boost on the reel\n')
    await mkdir(workspaceDir('iris'), { recursive: true })
    await writeFile(resolve(workspaceDir('iris'), 'secret.md'), 'boost the private one\n')

    await mkdir(brainDir(), { recursive: true })
    await writeFile(resolve(brainDir(), 'ad-budget.md'), '---\ntitle: Ad budget rules\ntype: process\n---\n\nAny boost over $50 needs an OK.\n')
    await writeFile(resolve(brainDir(), 'boost-glossary.md'), '---\ntitle: Boost glossary\ntype: process\n---\n\nPaid reach, explained.\n')

    const shared = await getSharedDb()
    await shared.execute('CREATE TABLE campaigns (name TEXT, channel TEXT, spend INTEGER)')
    await shared.execute("INSERT INTO campaigns VALUES ('Spring Boost', 'instagram', 180), ('Autumn', 'facebook', 90)")
    await shared.execute('CREATE TABLE keyed (code TEXT PRIMARY KEY, note TEXT) WITHOUT ROWID')
    await shared.execute("INSERT INTO keyed VALUES ('42', 'boost later')")
    const ada = await getAgentDb('ada')
    await ada.execute('CREATE TABLE leads (id INTEGER, name TEXT, notes TEXT)')
    await ada.execute("INSERT INTO leads VALUES (7, 'Lena Hart', 'came from the Black Friday boost')")
    const iris = await getAgentDb('iris')
    await iris.execute('CREATE TABLE ledger (note TEXT)')
    await iris.execute("INSERT INTO ledger VALUES ('boost')")
})

describe('GET /search', () => {
    it('refuses a query shorter than two characters', async () => {
        expect((await app.request('/search?q=b')).status).toBe(400)
        expect((await app.request('/search')).status).toBe(400)
    })

    it('finds a word in the souls, skills, files, Brain and tables of the coworkers it is given', async () => {
        const { hits, truncated } = await search('q=BOOST&agents=ada,noor')
        expect(truncated).toBe(false)
        expect(hits.filter(hit => hit.kind === 'coworker')).toEqual([
            { kind: 'coworker', agentId: 'ada', field: 'soul', line: 2, snippet: 'Every Monday, Boost the best post of the week.' },
            { kind: 'coworker', agentId: 'noor', field: 'soul', line: 1, snippet: 'You never boost a post without asking first.' },
        ])
        expect(hits.filter(hit => hit.kind === 'skill')).toEqual([
            { kind: 'skill', agentId: 'ada', slug: 'boost-top-posts', name: 'boost-top-posts', snippet: 'Pick the 3 best posts and boost them.' },
            { kind: 'skill', agentId: null, slug: 'weekly-report', name: 'weekly-report', snippet: 'List every boost still running.' },
        ])
        expect(hits.filter(hit => hit.kind === 'file')).toEqual([
            { kind: 'file', agentId: null, path: 'boost-ideas.txt', line: null, snippet: 'boost-ideas.txt' },
            { kind: 'file', agentId: null, path: 'marketing/q4-plan.md', line: 3, snippet: 'Boost budget: $400 a month.' },
            { kind: 'file', agentId: 'ada', path: 'ideas.md', line: 2, snippet: '- Try a boost on the reel' },
        ])
        expect(hits.filter(hit => hit.kind === 'brain')).toEqual([
            { kind: 'brain', slug: 'ad-budget', title: 'Ad budget rules', snippet: 'Any boost over $50 needs an OK.' },
            { kind: 'brain', slug: 'boost-glossary', title: 'Boost glossary', snippet: 'Paid reach, explained.' },
        ])
        expect(hits.filter(hit => hit.kind === 'table')).toEqual([
            { kind: 'table', agentId: null, table: 'campaigns', rowId: 1, title: 'Spring Boost', snippet: 'name: Spring Boost · channel: instagram · spend: 180' },
            { kind: 'table', agentId: null, table: 'keyed', rowId: null, title: 'boost later', snippet: 'note: boost later' },
            { kind: 'table', agentId: 'ada', table: 'leads', rowId: 1, title: 'Lena Hart', snippet: 'notes: came from the Black Friday boost' },
        ])
    })

    it('never reads a coworker the caller did not list, nor an id that is not one', async () => {
        const { hits } = await search('q=boost&agents=noor,../ada,ghost')
        expect(hits.some(hit => hit.agentId === 'iris' || hit.agentId === 'ada')).toBe(false)
        expect(hits.filter(hit => hit.kind === 'coworker').map(hit => hit.agentId)).toEqual(['noor'])
    })

    it('stops each source at its limit', async () => {
        const { hits } = await searchWorkspace('boost', ['ada', 'noor'], 1)
        expect(['coworker', 'skill', 'file', 'brain', 'table'].map(kind => hits.filter(hit => hit.kind === kind).length)).toEqual([1, 1, 1, 1, 1])
    })

    it('says so when it runs out of time', async () => {
        const now = Date.now()
        const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValue(now + 60_000)
        const result = await searchWorkspace('boost', ['ada'])
        clock.mockRestore()
        expect(result).toEqual({ hits: [], truncated: true })
    })
})

describe('the text a hit shows', () => {
    it('takes a skill described with the word, and a row titled by its first text', async () => {
        await writeSkill('noor', 'launch', 'Plan a boost for a launch', 'Read the calendar.')
        await writeSkill('noor', 'boost-only-in-name', 'Paid reach', 'Read the numbers.')
        const shared = await getSharedDb()
        await shared.execute('CREATE TABLE odd (amount INTEGER, meta TEXT, empty TEXT)')
        await shared.execute(`INSERT INTO odd VALUES (12, json('{"tag":"boost"}'), NULL)`)
        await shared.execute('CREATE TABLE numbers (code INTEGER, label TEXT)')
        await shared.execute("INSERT INTO numbers VALUES (31, '1234 boost')")
        const { hits } = await searchWorkspace('boost', ['noor'])
        expect(hits).toContainEqual({ kind: 'skill', agentId: 'noor', slug: 'launch', name: 'launch', snippet: 'Plan a boost for a launch' })
        expect(hits).toContainEqual({ kind: 'skill', agentId: 'noor', slug: 'boost-only-in-name', name: 'boost-only-in-name', snippet: 'boost-only-in-name' })
        expect(hits).toContainEqual(expect.objectContaining({ table: 'odd', title: '{"tag":"boost"}', snippet: 'meta: {"tag":"boost"}' }))
        expect(hits).toContainEqual(expect.objectContaining({ table: 'numbers', title: '1234 boost' }))
    })

    it('titles a row of numbers by its first value, and takes % and _ for what they are', async () => {
        const shared = await getSharedDb()
        await shared.execute('CREATE TABLE scores (points INTEGER, bonus INTEGER, note TEXT)')
        await shared.execute('INSERT INTO scores VALUES (4077, 3, NULL)')
        await shared.execute('INSERT INTO scores VALUES (NULL, NULL, NULL)')
        await shared.execute("INSERT INTO campaigns VALUES ('user-id', 'x', 1), ('user_id', 'x', 2), ('1000 views', 'x', 3), ('100% done', 'x', 4), ('C:\\ads', 'x', 5)")
        const campaignsFound = async (word: string) => (await searchWorkspace(word, [])).hits.filter(hit => hit.kind === 'table').map(hit => hit.title)
        expect((await searchWorkspace('4077', ['ada', 'noor', 'iris'])).hits).toContainEqual({ kind: 'table', agentId: null, table: 'scores', rowId: 1, title: '4077', snippet: 'points: 4077 · bonus: 3' })
        expect(await campaignsFound('user_id')).toEqual(['user_id'])
        expect(await campaignsFound('100%')).toEqual(['100% done'])
        expect(await campaignsFound('c:\\ads')).toEqual(['C:\\ads'])
    })

    it('keeps the other sources when one of them fails', async () => {
        const { rm } = await import('node:fs/promises')
        await rm(brainDir(), { recursive: true, force: true })
        await writeFile(brainDir(), 'not a folder')
        const { hits } = await searchWorkspace('boost', ['ada'])
        expect(hits.some(hit => hit.kind === 'brain')).toBe(false)
        expect(hits.some(hit => hit.kind === 'coworker')).toBe(true)
    })
})

describe('searchTableRows', () => {
    it('returns nothing for a blank query', async () => {
        expect(await searchTableRows(await getSharedDb(), 'campaigns', '  ', 5)).toEqual([])
    })
})

describe('snippetAround', () => {
    it('keeps a short line whole and cuts a long one around the word', () => {
        expect(snippetAround('  a   short\nline ', 'short')).toBe('a short line')
        const long = `${'lorem '.repeat(40)}boost${' ipsum'.repeat(40)}`
        const cut = snippetAround(long, 'BOOST')
        expect(cut.startsWith('…')).toBe(true)
        expect(cut.endsWith('…')).toBe(true)
        expect(cut).toContain('boost')
        expect(snippetAround(`boost ${'x'.repeat(300)}`, 'boost').endsWith('…')).toBe(true)
        expect(snippetAround(`${'x'.repeat(300)} boost`, 'boost')).toMatch(/^….*boost$/)
    })
})
