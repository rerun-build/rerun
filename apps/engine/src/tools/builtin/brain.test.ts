import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-brain-tool-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { brainTools, foremanBrainTools, FOREMAN_BRAIN_AUTHOR } = await import('./brain.js')
const { sharedTools } = await import('./shared.js')
const { writePage, readPageFile, listRevisions, revertPage } = await import('../../brain/pages.js')
const { acceptProposal, dismissProposal, listProposals, countOpenProposals, getProposal } = await import('../../brain/proposals.js')
const { buildBrainSection, buildForemanBrainSection, BRAIN_NOTE, FOREMAN_BRAIN_NOTE, EMPTY_FOR_AGENTS, EMPTY_WHEN_CALLED } = await import('../../brain/prompt.js')

const ctxFor = (id: string, name: string) => ({ agent: { id, config: { name } }, sessionId: 'session-1' }) as any
const tools = brainTools(ctxFor('agent-sales', 'Sales'))
const otherTools = brainTools(ctxFor('agent-support', 'Support'))

const call = (set: typeof tools, name: string, args: Record<string, unknown>) => (set[name] as any).execute(args, { toolCallId: 'c', messages: [] }) as Promise<string>
const propose = (set: typeof tools, args: Record<string, unknown>) =>
    call(set, 'brain_propose', { title: 'Pricing', headline: 'Starter costs more', highlights: [{ label: 'Starter', before: '49', after: '59' }], type: 'offering', reason: 'Price changed', sources: ['told by the user in chat'], baseHash: null, ...args })

describe('the company brain section of the prompt', () => {
    it('says the brain is empty before anything is written', async () => {
        expect(await buildBrainSection()).toBe(`${BRAIN_NOTE}\n\n${EMPTY_FOR_AGENTS}`)
        expect(await buildForemanBrainSection()).toBe(`${FOREMAN_BRAIN_NOTE}\n\nThe company brain is still empty.`)
    })

    it('keeps a coworker called by another one from passing the question on', async () => {
        expect(await buildBrainSection(true)).toBe(`${BRAIN_NOTE}\n\n${EMPTY_WHEN_CALLED}`)
        expect(EMPTY_WHEN_CALLED).not.toContain('call_agent')
    })
})

describe('brain_read and brain_search', () => {
    it('reports a missing page and an empty brain', async () => {
        expect(await call(tools, 'brain_read', { slug: 'pricing' })).toContain('The brain is still empty.')
        expect(await call(tools, 'brain_search', { query: 'pricing', limit: 5 })).toContain('Nothing in the company brain matches')
    })

    it('reads a page with its hash, sources and backlinks', async () => {
        await writePage('pricing', { title: 'Pricing', type: 'offering', content: 'Starter is 49 a month.', sources: ['site:pricing'], baseHash: null, author: 'seed' })
        await writePage('company', { title: 'Company', type: 'company', content: 'Acme sells widgets.\nSee [[pricing]].', sources: [], baseHash: null, author: 'seed' })
        const page = (await readPageFile('pricing'))!
        const out = await call(tools, 'brain_read', { slug: 'pricing' })
        expect(out).toContain('# Pricing')
        expect(out).toContain(`hash: ${page.hash}`)
        expect(out).toContain('sources: site:pricing')
        expect(out).toContain('linked from: [[company]]')
        expect(await call(tools, 'brain_read', { slug: 'missing' })).toContain('Existing pages: company, pricing.')
    })

    it('finds passages and the pages linked to them', async () => {
        const out = await call(tools, 'brain_search', { query: 'starter month', limit: 5 })
        expect(out).toContain('[[pricing]] Pricing (offering)')
        expect(out).toContain('Linked pages: [[company]] Company')
    })

    it('shortens a long passage', async () => {
        await writePage('history', { title: 'History', type: 'note', content: `Founded long ago. ${'word '.repeat(300)}`, sources: [], baseHash: null, author: 'seed' })
        const out = await call(tools, 'brain_search', { query: 'founded', limit: 1 })
        expect(out).toContain('...')
        expect(out).not.toContain('Linked pages')
    })
})

describe('brain_propose', () => {
    it('asks for a read first, then refuses an outdated or identical change', async () => {
        const page = (await readPageFile('pricing'))!
        expect(await propose(tools, { slug: 'pricing', content: 'Starter is 59.' })).toContain('already exists')
        expect(await propose(tools, { slug: 'pricing', content: 'Starter is 59.', baseHash: 'old' })).toContain('changed since you read it')
        expect(await propose(tools, { slug: 'pricing', content: page.content, baseHash: page.hash })).toContain('identical')
        expect(await countOpenProposals()).toBe(0)
    })

    it('records the change for review without touching the page', async () => {
        const page = (await readPageFile('pricing'))!
        const out = JSON.parse(await propose(tools, { slug: 'pricing', content: 'Starter is 59 a month.', baseHash: page.hash }))
        expect(out).toMatchObject({ status: 'proposed', slug: 'pricing', title: 'Pricing' })
        expect((await readPageFile('pricing'))!.content).toBe('Starter is 49 a month.')
        const [proposal] = await listProposals('proposed')
        expect(proposal).toMatchObject({ id: out.proposalId, agentName: 'Sales', mode: 'edit', outdated: false, currentContent: 'Starter is 49 a month.', sources: ['told by the user in chat'], headline: 'Starter costs more', highlights: [{ label: 'Starter', before: '49', after: '59' }] })
    })

    it('replaces the same agent’s pending change on that page instead of stacking a second one', async () => {
        const page = (await readPageFile('pricing'))!
        const first = (await listProposals('proposed'))[0]
        const out = JSON.parse(await propose(tools, { slug: 'pricing', content: 'Starter is 59 a month, Pro is 99.', baseHash: page.hash, headline: 'Pro is priced', highlights: [{ label: 'Pro', before: null, after: '99' }] }))
        expect(out).toMatchObject({ status: 'updated', proposalId: first.id })
        expect(await countOpenProposals()).toBe(1)
        expect((await getProposal(first.id))!).toMatchObject({ content: 'Starter is 59 a month, Pro is 99.', headline: 'Pro is priced', highlights: [{ label: 'Pro', before: null, after: '99' }] })
    })

    it('never sends the same change twice, even once dismissed', async () => {
        const page = (await readPageFile('pricing'))!
        expect(await propose(tools, { slug: 'pricing', content: 'Starter is 59 a month, Pro is 99.', baseHash: page.hash })).toContain('already proposed')
        const out = JSON.parse(await propose(otherTools, { slug: 'pricing', content: 'Starter is 39.', baseHash: page.hash }))
        await dismissProposal(out.proposalId, 'user:1')
        expect(await propose(otherTools, { slug: 'pricing', content: 'Starter is 39.', baseHash: page.hash })).toContain('already proposed')
    })

    it('proposes a new page as a create', async () => {
        const out = JSON.parse(await propose(otherTools, { slug: 'globex', title: 'Globex', type: 'competitor', content: 'Cheaper, worse support.' }))
        expect((await getProposal(out.proposalId))!).toMatchObject({ mode: 'create', baseHash: null })
    })
})

describe('deciding a proposal', () => {
    it('writes the page under the agent’s name once a person accepts, and only once', async () => {
        const [proposal] = (await listProposals('proposed')).filter(p => p.slug === 'pricing')
        const accepted = await acceptProposal(proposal.id, 'user:7')
        expect(accepted).toMatchObject({ status: 'accepted', decidedBy: 'user:7', outdated: false })
        const page = (await readPageFile('pricing'))!
        expect(page).toMatchObject({ content: 'Starter is 59 a month, Pro is 99.', updatedBy: 'agent:Sales', sources: ['told by the user in chat'] })
        const again = await acceptProposal(proposal.id, 'user:8')
        expect(again.decidedBy).toBe('user:7')
    })

    it('flags a create whose page appeared meanwhile, and lets the person accept their own wording', async () => {
        const pending = (await listProposals('proposed')).find(p => p.slug === 'globex')!
        await writePage('globex', { title: 'Globex', type: 'competitor', content: 'Written by hand.', sources: [], baseHash: null, author: 'user:1' })
        const listed = (await listProposals()).find(p => p.id === pending.id)!
        expect(listed).toMatchObject({ outdated: true, currentContent: 'Written by hand.' })
        await acceptProposal(pending.id, 'user:1', { content: 'Merged by the person.', title: 'Globex Inc' })
        expect((await readPageFile('globex'))!).toMatchObject({ content: 'Merged by the person.', title: 'Globex Inc', type: 'competitor' })
    })

    it('puts the proposal back when the write fails', async () => {
        const broken = JSON.parse(await propose(otherTools, { slug: 'other-new', title: 'Other', type: 'note', content: 'Fresh too.' }))
        const { getBrainDb } = await import('../../db/brainDb.js')
        const client = await getBrainDb()
        await client.execute({ sql: "UPDATE brain_proposals SET slug = 'Bad Slug' WHERE id = ?", args: [broken.proposalId] })
        await expect(acceptProposal(broken.proposalId, 'user:1')).rejects.toMatchObject({ status: 400 })
        expect((await getProposal(broken.proposalId))!).toMatchObject({ status: 'proposed', decidedBy: null })
    })

    it('reports an unknown proposal', async () => {
        await expect(acceptProposal('nope', 'user:1')).rejects.toMatchObject({ status: 404 })
        await expect(dismissProposal('nope', 'user:1')).rejects.toMatchObject({ status: 404 })
    })
})

describe('the company brain section once pages exist', () => {
    it('shows the company card and the page index, card first', async () => {
        const section = await buildBrainSection()
        expect(section).toContain('Company card (brain_read "company" for the rest):\nAcme sells widgets.')
        expect(section.indexOf('- [[company]]')).toBeLessThan(section.indexOf('- [[pricing]]'))
    })

    it('lists the product pages on one line of their own, after the other pages', async () => {
        for (let i = 0; i < 30; i++)
            await writePage(`product-${i}`, { title: `A product with a rather long title number ${i}`, type: 'product', content: 'x', sources: ['site:catalog'], baseHash: null, author: 'seed' })
        const section = await buildBrainSection()
        const productLines = section.split('\n').filter(line => line.includes('[[product-'))
        expect(productLines).toHaveLength(1)
        expect(productLines[0]).toMatch(/^- Products \(30\): \[\[product-\d+\]\] A product/)
        expect(productLines[0]).toMatch(/, and \d+ more, find them with brain_search$/)
        expect(section.indexOf('- [[pricing]]')).toBeLessThan(section.indexOf('- Products (30)'))
    })

    it('caps the index and points at brain_search for the rest', async () => {
        for (let i = 0; i < 90; i++) await writePage(`note-${i}`, { title: `A note with a fairly long title number ${i}`, type: 'note', content: 'x', sources: [], baseHash: null, author: 'seed' })
        expect(await buildBrainSection()).toMatch(/and \d+ more, find them with brain_search\./)
    })
})

describe('shared_ tools', () => {
    it('cannot reach the brain folder, which only changes through a review', async () => {
        const shared = sharedTools({ agent: { id: 'agent-sales' } } as any)
        await expect((shared.shared_write as any).execute({ path: '../brain/pricing.md', content: 'hacked' }, { toolCallId: 'c', messages: [] })).rejects.toThrow(/escapes the root/)
        expect((await readPageFile('pricing'))!.content).not.toBe('hacked')
    })
})

describe("the foreman's brain tools", () => {
    const foreman = foremanBrainTools()

    it('are not handed to an agent, which writes only what the user told it and proposes the rest', () => {
        expect(Object.keys(tools)).toEqual(['brain_search', 'brain_read', 'brain_write', 'brain_propose'])
        expect(Object.keys(foreman)).toEqual(['brain_search', 'brain_read', 'brain_write', 'brain_delete', 'brain_proposals', 'brain_decide'])
    })

    it('writes a new page at once, signed by the foreman', async () => {
        const out = JSON.parse(await call(foreman, 'brain_write', { slug: 'refunds', title: 'Refunds', type: 'decision', content: '30 days, no questions.', sources: ['told by the user in chat'], baseHash: null }))
        expect(out).toMatchObject({ status: 'saved', slug: 'refunds', title: 'Refunds', mode: 'create' })
        expect((await readPageFile('refunds'))!).toMatchObject({ content: '30 days, no questions.', updatedBy: FOREMAN_BRAIN_AUTHOR })
    })

    it('edits a page only against the version it read', async () => {
        const page = (await readPageFile('refunds'))!
        const write = (args: Record<string, unknown>) => call(foreman, 'brain_write', { slug: 'refunds', title: 'Refunds', type: 'decision', sources: [], ...args })
        expect(await write({ content: '14 days.', baseHash: null })).toContain('already exists')
        expect(await write({ content: '14 days.', baseHash: 'stale' })).toContain('changed since it was read')
        expect(await write({ content: page.content, sources: page.sources, baseHash: page.hash })).toContain('identical')
        expect(JSON.parse(await write({ content: '14 days.', baseHash: page.hash }))).toMatchObject({ status: 'saved', mode: 'edit' })
        expect((await readPageFile('refunds'))!.content).toBe('14 days.')
    })

    it('lists the waiting changes and settles them for the user', async () => {
        const page = (await readPageFile('refunds'))!
        const first = JSON.parse(await propose(tools, { slug: 'refunds', title: 'Refunds', type: 'decision', content: '21 days.', baseHash: page.hash }))
        const second = JSON.parse(await propose(otherTools, { slug: 'refunds', title: 'Refunds', type: 'decision', content: '7 days.', baseHash: page.hash }))
        const listed = await call(foreman, 'brain_proposals', {})
        expect(listed).toContain(`proposalId: ${first.proposalId}`)
        expect(listed).toContain('by Support')

        expect(JSON.parse(await call(foreman, 'brain_decide', { proposalId: first.proposalId, decision: 'accept', content: '21 days, store credit after.' }))).toMatchObject({ status: 'accepted', slug: 'refunds', agentName: 'Sales' })
        expect((await readPageFile('refunds'))!).toMatchObject({ content: '21 days, store credit after.', updatedBy: 'agent:Sales' })
        expect((await getProposal(first.proposalId))!.decidedBy).toBe(FOREMAN_BRAIN_AUTHOR)

        expect(JSON.parse(await call(foreman, 'brain_decide', { proposalId: second.proposalId, decision: 'dismiss', content: null }))).toMatchObject({ status: 'dismissed' })
        expect(await call(foreman, 'brain_decide', { proposalId: second.proposalId, decision: 'accept', content: null })).toContain('already dismissed')
        expect(await call(foreman, 'brain_decide', { proposalId: 'nope', decision: 'accept', content: null })).toContain('No proposal')
    })

    it('tells the foreman how many changes wait, in its own note', async () => {
        const page = (await readPageFile('refunds'))!
        await propose(tools, { slug: 'refunds', title: 'Refunds', type: 'decision', content: '45 days.', baseHash: page.hash })
        const section = await buildForemanBrainSection()
        expect(section.startsWith(FOREMAN_BRAIN_NOTE)).toBe(true)
        expect(section).toContain(`Changes proposed by the coworkers, waiting for review: ${await countOpenProposals()} (brain_proposals).`)
        expect(await buildBrainSection()).not.toContain('waiting for review')
    })

    it('deletes a page', async () => {
        expect(JSON.parse(await call(foreman, 'brain_delete', { slug: 'refunds', confirm: true }))).toMatchObject({ status: 'deleted', slug: 'refunds', title: 'Refunds' })
        expect(await readPageFile('refunds')).toBeNull()
        expect(await call(foreman, 'brain_delete', { slug: 'refunds', confirm: true })).toContain('No page "refunds"')
    })
})

describe('what the user tells a coworker', () => {
    const inChat = brainTools({ ...ctxFor('agent-sales', 'Sales'), author: { id: 'u1', name: 'Salman' } })
    const write = (set: typeof tools, args: Record<string, unknown>) => call(set, 'brain_write', { slug: 'audience', title: 'Audience', type: 'market', sources: ['told by the user in chat'], ...args })

    it('is written at once, signed by the coworker, with the revision to undo it', async () => {
        await writePage('audience', { title: 'Audience', type: 'market', content: '## Buyers\nRecruiters.', sources: ['linkedin:company'], baseHash: null, author: 'seed' })
        const seeded = (await readPageFile('audience'))!
        const [before] = await listRevisions('audience', 1)

        const out = JSON.parse(await write(inChat, { content: '## Buyers\nFounders, SDRs, BDRs and AEs.', baseHash: seeded.hash }))
        expect(out).toMatchObject({ status: 'saved', slug: 'audience', mode: 'edit', undoRevisionId: before.id })
        const written = (await readPageFile('audience'))!
        expect(written).toMatchObject({ updatedBy: 'agent:Sales', unconfirmed: [] })
        expect(out.hash).toBe(written.hash)
    })

    it('keeps one revision per write, so a second correction minutes later undoes to the first', async () => {
        const first = (await readPageFile('audience'))!
        const revisionsBefore = (await listRevisions('audience')).length
        const out = JSON.parse(await write(inChat, { content: '## Buyers\nFounders and SDRs.', baseHash: first.hash }))
        expect(await listRevisions('audience')).toHaveLength(revisionsBefore + 1)
        expect((await revertPage('audience', out.undoRevisionId, 'user:1')).content).toBe(first.content)
    })

    it('is refused when no person is in the conversation', async () => {
        const page = (await readPageFile('audience'))!
        expect(await write(tools, { content: '## Buyers\nAgencies.', baseHash: page.hash })).toContain('use brain_propose')
        expect((await readPageFile('audience'))!.content).toContain('Founders')
    })

    it('has nothing to undo on a new page', async () => {
        expect(JSON.parse(await write(inChat, { slug: 'regions', title: 'Regions', content: 'India and the US.', baseHash: null }))).toMatchObject({ mode: 'create', undoRevisionId: null })
    })
})

describe('unconfirmed sections, as the agents see them', () => {
    it('are named when reading, searching and in the prompt', async () => {
        await writePage('icp', { title: 'Ideal customer', type: 'market', content: `## Audience\nRecruiters and list builders. ${'more '.repeat(60)}\n\n## Presence\nLinkedIn page.`, sources: [], baseHash: null, author: 'seed' })
        const page = (await readPageFile('icp'))!
        await writePage('icp', { title: 'Ideal customer', type: 'market', content: page.content.replace('LinkedIn page.', 'LinkedIn page and website.'), sources: [], baseHash: page.hash, author: 'user:1' })

        expect(await call(tools, 'brain_read', { slug: 'icp' })).toContain('unconfirmed sections: Audience (imported from the public web')
        const found = await call(tools, 'brain_search', { query: 'recruiters list builders', limit: 5 })
        expect(found).toContain('> Audience / Presence (unconfirmed): Recruiters')
        expect(await buildBrainSection()).toContain('- [[icp]] Ideal customer (market, unconfirmed: Audience)')
    })
})
