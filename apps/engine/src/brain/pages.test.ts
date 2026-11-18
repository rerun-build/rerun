import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-brain-pages-'))
process.env.RERUN_API_KEY = ''

const embed = vi.hoisted(() => ({ calls: [] as string[], fail: false, gate: null as Promise<void> | null }))
vi.mock('../memory/embed.js', () => ({
    embedText: async (text: string) => {
        embed.calls.push(text)
        if (embed.gate) await embed.gate
        if (embed.fail) return null
        const v = new Array(1536).fill(0)
        v[text.length % 1536] = 1
        return v
    },
}))

const { describe, expect, it, beforeEach } = await import('vitest')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { existsSync } = await import('node:fs')
const pages = await import('./pages.js')
const { embedPendingChunks } = await import('./embedding.js')
const { maintainBrain, maintainBrainIfDue, syncBrainIndex } = await import('./maintenance.js')
const { seedBrain } = await import('./seed.js')
const { getBrainDb } = await import('../db/brainDb.js')
const { brainDir, brainPagePath } = await import('../config/paths.js')

const long = (word: string) => `${word} lorem `.repeat(40).trim()

async function settle() {
    await embedPendingChunks()
}

async function pendingCount(): Promise<number> {
    const client = await getBrainDb()
    const rs = await client.execute('SELECT COUNT(*) AS n FROM brain_chunks WHERE embedding IS NULL')
    return Number(rs.rows[0].n)
}

beforeEach(async () => {
    await settle()
    embed.calls = []
    embed.fail = false
    embed.gate = null
})

describe('writePage', () => {
    it('writes the markdown file with its frontmatter, indexes it and keeps a revision', async () => {
        const page = await pages.writePage('offering', {
            title: 'Offering',
            type: 'offering',
            content: `## Pricing\n${long('price')}\n\nSee [[acme-corp]].`,
            sources: ['site:pricing'],
            baseHash: null,
            author: 'user:1',
        })
        const raw = await readFile(brainPagePath('offering'), 'utf8')
        expect(raw).toContain('title: Offering')
        expect(raw).toContain("updatedBy: 'user:1'")
        expect(raw).toContain("- 'site:pricing'")

        const read = await pages.getPage('offering')
        expect(read).toMatchObject({ slug: 'offering', title: 'Offering', type: 'offering', hash: page.hash, links: ['acme-corp'], sources: ['site:pricing'] })
        expect((await pages.listRevisions('offering')).map(r => r.author)).toEqual(['user:1'])
        expect(await pages.listPages()).toEqual([expect.objectContaining({ slug: 'offering', hash: page.hash })])
    })

    it('embeds the new chunks behind the write', async () => {
        await pages.writePage('team', { title: 'Team', type: 'team', content: long('founder'), sources: [], baseHash: null, author: 'seed' })
        await settle()
        expect(await pendingCount()).toBe(0)
        expect(embed.calls.some(t => t.startsWith('Team (team) > Overview'))).toBe(true)
    })

    it('embeds the chunks written while a pass was already running', async () => {
        let release!: () => void
        embed.gate = new Promise<void>(resolve => (release = resolve))
        await pages.writePage('burst-first', { title: 'Burst first', type: 'note', content: long('tooling'), sources: [], baseHash: null, author: 'seed' })
        await vi.waitFor(() => expect(embed.calls.length).toBeGreaterThan(0))
        await pages.writePage('burst-second', { title: 'Burst second', type: 'note', content: long('tone'), sources: [], baseHash: null, author: 'seed' })
        release()
        embed.gate = null
        await settle()
        expect(await pendingCount()).toBe(0)
        expect(embed.calls.some(t => t.startsWith('Burst second (note) > Overview'))).toBe(true)
    })

    it('refuses an edit made against an older version, and a create on a page that exists', async () => {
        const current = await pages.readPageFile('offering')
        const edit = { title: 'Offering', type: 'offering' as const, content: 'changed', sources: [], author: 'user:1' }
        await expect(pages.writePage('offering', { ...edit, baseHash: 'stale' })).rejects.toMatchObject({ status: 409 })
        await expect(pages.writePage('offering', { ...edit, baseHash: null })).rejects.toMatchObject({ status: 409 })
        await expect(pages.writePage('ghost', { ...edit, baseHash: current!.hash })).rejects.toMatchObject({ status: 409 })
    })

    it('rejects a slug that is not kebab-case', async () => {
        await expect(pages.writePage('Not OK', { title: 'x', type: 'note', content: 'x', sources: [], baseHash: null, author: 'user:1' })).rejects.toMatchObject({ status: 400 })
    })

    it('does nothing when the content is unchanged', async () => {
        const current = (await pages.readPageFile('offering'))!
        const again = await pages.writePage('offering', { title: current.title, type: current.type, content: current.content, sources: current.sources, baseHash: current.hash, author: 'user:2' })
        expect(again.updatedBy).toBe('user:1')
        expect(await pages.listRevisions('offering')).toHaveLength(1)
    })

    it('keeps the embedding of a section that did not change', async () => {
        await pages.writePage('market', { title: 'Market', type: 'market', content: `## Audience\n${long('smb')}\n\n## Competitors\n${long('rival')}`, sources: [], baseHash: null, author: 'seed' })
        await settle()
        embed.calls = []
        const current = (await pages.readPageFile('market'))!
        await pages.writePage('market', { title: 'Market', type: 'market', content: `## Audience\n${long('smb')}\n\n## Competitors\n${long('other')}`, sources: [], baseHash: current.hash, author: 'user:1' })
        await settle()
        expect(embed.calls).toHaveLength(1)
        expect(embed.calls[0]).toContain('Competitors')
    })

    it('serialises two writes on the same page so the second one sees the first', async () => {
        const base = (await pages.readPageFile('team'))!
        const write = (content: string) => pages.writePage('team', { title: 'Team', type: 'team', content, sources: [], baseHash: base.hash, author: 'user:1' })
        const results = await Promise.allSettled([write('first version'), write('second version')])
        expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    })
})

describe('backlinks, revisions and revert', () => {
    it('lists the pages linking to a page', async () => {
        await pages.writePage('acme-corp', { title: 'Acme Corp', type: 'customer', content: 'Our first customer.', sources: [], baseHash: null, author: 'seed' })
        expect(await pages.backlinks('acme-corp')).toEqual([{ slug: 'offering', title: 'Offering' }])
        expect((await pages.getPage('acme-corp'))!.backlinks).toEqual([{ slug: 'offering', title: 'Offering' }])
    })

    it('reverts a page to an earlier revision as a new revision', async () => {
        const first = (await pages.readPageFile('acme-corp'))!
        await pages.writePage('acme-corp', { title: 'Acme', type: 'customer', content: 'Renamed.', sources: [], baseHash: first.hash, author: 'user:1' })
        const [, original] = await pages.listRevisions('acme-corp')
        const found = await pages.getRevision('acme-corp', original.id)
        expect(found?.content).toBe('Our first customer.')
        const reverted = await pages.revertPage('acme-corp', original.id, 'user:3')
        expect(reverted).toMatchObject({ title: 'Acme Corp', content: 'Our first customer.', updatedBy: 'user:3', type: 'customer' })
        expect(await pages.listRevisions('acme-corp')).toHaveLength(3)
        expect(await pages.getRevision('acme-corp', 'nope')).toBeNull()
        await expect(pages.revertPage('acme-corp', 'nope', 'user:3')).rejects.toMatchObject({ status: 404 })
    })

    it('folds a person autosaving into one revision, and starts a new one for anything else', async () => {
        const edit = async (content: string, author: string) => {
            const current = await pages.readPageFile('drafting')
            return pages.writePage('drafting', { title: 'Drafting', type: 'note', content, sources: [], baseHash: current?.hash ?? null, author })
        }
        await edit('d', 'user:1')
        await edit('dr', 'user:1')
        await edit('dra', 'user:1')
        const folded = await pages.listRevisions('drafting')
        expect(folded).toHaveLength(1)
        expect((await pages.getRevision('drafting', folded[0].id))!.content).toBe('dra')

        await edit('draft', 'user:2')
        expect(await pages.listRevisions('drafting')).toHaveLength(2)

        const proposed = (await pages.readPageFile('drafting'))!
        await pages.writePage('drafting', { title: 'Drafting', type: 'note', content: 'proposed', sources: [], baseHash: proposed.hash, force: true, proposalId: 'p1', author: 'user:2' })
        await edit('after the proposal', 'user:2')
        expect(await pages.listRevisions('drafting')).toHaveLength(4)

        const [, , , first] = await pages.listRevisions('drafting')
        await pages.revertPage('drafting', first.id, 'user:2')
        expect(await pages.listRevisions('drafting')).toHaveLength(5)

        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            vi.setSystemTime(Date.now() + 11 * 60_000)
            await edit('much later', 'user:2')
        } finally {
            vi.useRealTimers()
        }
        expect(await pages.listRevisions('drafting')).toHaveLength(6)
    })

    it('reverts a page that was deleted meanwhile as a note', async () => {
        const [revision] = await pages.listRevisions('acme-corp')
        await pages.deletePage('acme-corp')
        const restored = await pages.revertPage('acme-corp', revision.id, 'user:3')
        expect(restored).toMatchObject({ type: 'note', sources: [] })
    })
})

describe('deletePage', () => {
    it('removes the file and everything indexed from it', async () => {
        await pages.deletePage('acme-corp')
        expect(existsSync(brainPagePath('acme-corp'))).toBe(false)
        expect(await pages.getPage('acme-corp')).toBeNull()
        const client = await getBrainDb()
        const rs = await client.execute({ sql: 'SELECT COUNT(*) AS n FROM brain_chunks WHERE slug = ?', args: ['acme-corp'] })
        expect(Number(rs.rows[0].n)).toBe(0)
        await expect(pages.deletePage('acme-corp')).rejects.toMatchObject({ status: 404 })
    })
})

describe('reading files written by hand', () => {
    it('falls back to the slug, the note type and an unquoted date', async () => {
        await writeFile(resolve(brainDir(), 'loose-note.md'), '---\ntype: nonsense\nupdatedAt: 2026-01-02T03:04:05.000Z\nsources: [a, 2]\n---\nJust text.\n')
        await writeFile(resolve(brainDir(), 'Bad Name.md'), 'ignored')
        await mkdir(resolve(brainDir(), 'folder.md'), { recursive: true })
        const page = (await pages.readPageFile('loose-note'))!
        expect(page).toMatchObject({ title: 'loose-note', type: 'note', updatedAt: '2026-01-02T03:04:05.000Z', updatedBy: 'user', sources: ['a', '2'] })
        expect(await pages.readPageFile('Bad Name')).toBeNull()
        expect((await pages.listPageFiles()).map(p => p.slug)).toContain('loose-note')
    })

    it('reads no date at all as empty', async () => {
        await writeFile(resolve(brainDir(), 'bare.md'), 'No frontmatter.\n')
        expect(await pages.readPageFile('bare')).toMatchObject({ updatedAt: '', title: 'bare' })
        await rm(resolve(brainDir(), 'bare.md'))
    })
})

describe('sortPages', () => {
    it('puts the identity card first in its order, then the rest by title', () => {
        const sorted = pages.sortPages([
            { type: 'note', title: 'B' },
            { type: 'team', title: 'Team' },
            { type: 'customer', title: 'A' },
            { type: 'company', title: 'Company' },
        ])
        expect(sorted.map(p => p.title)).toEqual(['Company', 'Team', 'A', 'B'])
    })
})

describe('maintenance', () => {
    it('folds pages edited, added or removed on disk back into the index', async () => {
        const offering = await readFile(brainPagePath('offering'), 'utf8')
        await writeFile(brainPagePath('offering'), offering.replace('See [[acme-corp]].', 'See [[market]].'))
        await rm(brainPagePath('team'))
        const result = await syncBrainIndex()
        expect(result.reindexed).toBeGreaterThanOrEqual(2)
        expect(result.removed).toBe(1)
        expect(await pages.backlinks('market')).toEqual([{ slug: 'offering', title: 'Offering' }])
        expect((await pages.listPages()).map(p => p.slug)).toContain('loose-note')
    })

    it('leaves chunks without a vector while the hub is down, then fills them', async () => {
        embed.fail = true
        await pages.writePage('pricing', { title: 'Pricing', type: 'offering', content: `${long('a')}\n\n## B\n${long('b')}\n\n## C\n${long('c')}\n\n## D\n${long('d')}`, sources: [], baseHash: null, author: 'seed' })
        await settle()
        expect(await pendingCount()).toBe(4)
        expect(embed.calls).toHaveLength(3)

        embed.fail = false
        await maintainBrain()
        expect(await pendingCount()).toBe(0)
    })

    it('runs at most once per interval', async () => {
        await maintainBrainIfDue()
        embed.calls = []
        await pages.writePage('voice', { title: 'Voice', type: 'voice', content: 'Warm.', sources: [], baseHash: null, author: 'seed' })
        await settle()
        embed.calls = []
        await maintainBrainIfDue()
        expect(embed.calls).toHaveLength(0)
    })
})

describe('seedBrain', () => {
    it('writes new pages, refreshes its own, and never touches one a person edited', async () => {
        const result = await seedBrain([
            { slug: 'company', title: 'Company', type: 'company', content: 'We sell widgets.', sources: [] },
            { slug: 'offering', title: 'Offering', type: 'offering', content: 'Overwritten?', sources: [] },
            { slug: 'voice', title: 'Voice', type: 'voice', content: 'Warm.', sources: [] },
            { slug: 'pricing', title: 'Pricing', type: 'offering', content: 'From 10 EUR.', sources: ['site'] },
        ])
        expect(result).toEqual({ written: ['company', 'pricing'], skipped: ['offering', 'voice'] })
        expect((await pages.readPageFile('offering'))!.content).not.toBe('Overwritten?')
    })
})

describe('unconfirmed sections', () => {
    const seeded = '## Audience\n- Recruiters\n- List builders\n\n## Pricing\nPro is 10 a month.'

    it('marks every section the seed wrote, in the frontmatter', async () => {
        await seedBrain([{ slug: 'buyers', title: 'Market', type: 'market', content: seeded, sources: ['linkedin:company'] }])
        expect((await pages.readPageFile('buyers'))!.unconfirmed).toEqual(['Audience', 'Pricing'])
        expect(await readFile(brainPagePath('buyers'), 'utf8')).toContain('unconfirmed:\n  - Audience\n  - Pricing')
    })

    it('reads a seeded page from before the list as unconfirmed throughout, and a person\'s page as confirmed', async () => {
        await writeFile(resolve(brainDir(), 'legacy-seed.md'), "---\ntitle: Legacy\ntype: note\nupdatedBy: seed\n---\nIntro.\n\n## Customers\nNone named.\n")
        await writeFile(resolve(brainDir(), 'legacy-user.md'), "---\ntitle: Legacy\ntype: note\nupdatedBy: 'user:1'\n---\n## Customers\nAcme.\n")
        expect((await pages.readPageFile('legacy-seed'))!.unconfirmed).toEqual(['Overview', 'Customers'])
        expect((await pages.readPageFile('legacy-user'))!.unconfirmed).toEqual([])
    })

    it('confirms only the sections a person changed, not the ones the editor merely reformatted', async () => {
        const current = (await pages.readPageFile('buyers'))!
        const content = '## Audience\n* Founders\n* SDRs\n\n## Pricing\nPro is **10** a month.'
        const page = await pages.writePage('buyers', { title: 'Market', type: 'market', content, sources: [], baseHash: current.hash, author: 'user:1' })
        expect(page.unconfirmed).toEqual(['Pricing'])
    })

    it('confirms a new or renamed section, and drops a heading that is gone', async () => {
        const current = (await pages.readPageFile('buyers'))!
        const page = await pages.writePage('buyers', { title: 'Market', type: 'market', content: '## Price\nPro is 10 a month.', sources: [], baseHash: current.hash, author: 'agent:Sales' })
        expect(page.unconfirmed).toEqual([])
    })

    it('brings the seed version back unconfirmed when a person undoes a correction', async () => {
        const [seededRevision] = (await pages.listRevisions('buyers')).filter(r => r.author === 'seed')
        expect((await pages.revertPage('buyers', seededRevision.id, 'user:1')).unconfirmed).toEqual(['Audience', 'Pricing'])
    })

    it('confirms sections by hand without touching the content, its hash or its history', async () => {
        await seedBrain([{ slug: 'positioning', title: 'Positioning', type: 'note', content: '## Promise\nFast.\n\n## Tone\nPlain.', sources: [] }])
        const before = (await pages.readPageFile('positioning'))!
        const revisions = (await pages.listRevisions('positioning')).length

        const one = await pages.confirmSections('positioning', ['Tone'])
        expect(one).toMatchObject({ unconfirmed: ['Promise'], hash: before.hash, updatedBy: 'seed' })
        expect((await pages.readPageFile('positioning'))!.unconfirmed).toEqual(['Promise'])

        expect((await pages.confirmSections('positioning', null)).unconfirmed).toEqual([])
        expect((await pages.readPageFile('positioning'))!.unconfirmed).toEqual([])
        expect(await pages.listRevisions('positioning')).toHaveLength(revisions)
        await expect(pages.confirmSections('missing', null)).rejects.toThrow()
    })

    it('keeps a page away from the next seed once a person confirmed any of its sections', async () => {
        const seed = (content: string) => seedBrain([{ slug: 'brand', title: 'Brand', type: 'note', content, sources: [] }])
        await seed('## Promise\nFast.\n\n## Tone\nPlain.')
        await pages.confirmSections('brand', ['Tone'])
        expect(await seed('## Promise\nSlow.\n\n## Tone\nLoud.')).toEqual({ written: [], skipped: ['brand'] })
        expect((await pages.readPageFile('brand'))!).toMatchObject({ content: '## Promise\nFast.\n\n## Tone\nPlain.', unconfirmed: ['Promise'] })

        await pages.confirmSections('brand', null)
        expect(await seed('## Promise\nSlow.')).toEqual({ written: [], skipped: ['brand'] })
        expect((await pages.readPageFile('brand'))!.unconfirmed).toEqual([])
    })
})

describe('filing a page', () => {
    const write = (slug: string, author: string, extra: Partial<Parameters<typeof pages.writePage>[1]> = {}, baseHash: string | null = null) =>
        pages.writePage(slug, { title: 'Acme Corp', type: 'customer', content: `## Who\n${long('acme')}`, sources: [], baseHash, author, ...extra })

    it('files a new page under the Box of the coworker that wrote it, with its tags, in the frontmatter and the list', async () => {
        await write('acme-filed', 'agent:lead-finder', { tags: ['#Acme', 'pipeline', 'acme'], spaceId: 'box-sales' })
        const raw = await readFile(brainPagePath('acme-filed'), 'utf8')
        expect(raw).toContain("createdBy: 'agent:lead-finder'")
        expect(raw).toContain('spaceId: box-sales')
        expect((await pages.readPageFile('acme-filed'))!.tags).toEqual(['acme', 'pipeline'])
        expect((await pages.listPages()).find(page => page.slug === 'acme-filed')).toMatchObject({ tags: ['acme', 'pipeline'], createdBy: 'agent:lead-finder', spaceId: 'box-sales' })
    })

    it('keeps the first author and the Box when someone else edits, and adds the tags it brings', async () => {
        const current = (await pages.readPageFile('acme-filed'))!
        await write('acme-filed', 'user:theo', { content: `## Who\n${long('acme stores')}`, tags: ['pilot'], spaceId: 'box-support' }, current.hash)
        expect(await pages.getPage('acme-filed')).toMatchObject({ updatedBy: 'user:theo', createdBy: 'agent:lead-finder', spaceId: 'box-sales', tags: ['acme', 'pipeline', 'pilot'] })
    })

    it('adds tags to an unchanged page without a new revision', async () => {
        const before = (await pages.listRevisions('acme-filed')).length
        const current = (await pages.readPageFile('acme-filed'))!
        await write('acme-filed', 'agent:outreach', { content: current.content, tags: ['q4'] }, current.hash)
        expect((await pages.readPageFile('acme-filed'))!.tags).toEqual(['acme', 'pipeline', 'pilot', 'q4'])
        expect((await pages.listRevisions('acme-filed')).length).toBe(before)
    })

    it('moves the Box and replaces the tags by hand, leaving the hash and the history alone', async () => {
        const before = (await pages.readPageFile('acme-filed'))!
        const revisions = (await pages.listRevisions('acme-filed')).length
        const filed = await pages.setPageMeta('acme-filed', { tags: ['acme'], spaceId: null })
        expect(filed).toMatchObject({ hash: before.hash, tags: ['acme'], spaceId: null, createdBy: 'agent:lead-finder' })
        expect((await pages.listPages()).find(page => page.slug === 'acme-filed')).toMatchObject({ tags: ['acme'], spaceId: null })
        expect((await pages.listRevisions('acme-filed')).length).toBe(revisions)
    })

    it('reads a page from before filing as added by the author of its oldest revision', async () => {
        await write('legacy', 'agent:scout')
        const current = (await pages.readPageFile('legacy'))!
        await write('legacy', 'user:alice', { content: `## Who\n${long('legacy two')}` }, current.hash)
        const raw = await readFile(brainPagePath('legacy'), 'utf8')
        await writeFile(brainPagePath('legacy'), raw.replace(/^createdBy: .*\n/m, '').replace(/^spaceId: .*\n/m, ''))
        expect((await pages.readPageFile('legacy'))!.createdBy).toBeNull()
        expect((await pages.getPage('legacy'))!.createdBy).toBe('agent:scout')
    })

    it('follows a renamed coworker as the first author of a page from before filing', async () => {
        await pages.reattributePages('agent:scout', 'agent:scout-renamed')
        expect((await pages.readPageFile('legacy'))!.createdBy).toBeNull()
        expect((await pages.getPage('legacy'))!.createdBy).toBe('agent:scout-renamed')
    })

    it('follows a renamed coworker as the first author', async () => {
        await pages.reattributePages('agent:lead-finder', 'agent:prospector')
        expect((await pages.getPage('acme-filed'))!.createdBy).toBe('agent:prospector')
        expect((await pages.listPages()).find(page => page.slug === 'acme-filed')!.createdBy).toBe('agent:prospector')
    })
})
