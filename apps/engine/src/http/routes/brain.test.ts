import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-brain-routes-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { createServer } = await import('../server.js')
const { insertProposal, proposalFingerprint } = await import('../../brain/proposals.js')

const app = createServer()

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function proposal(content: string) {
    return insertProposal({
        agentId: 'agent-1',
        agentName: 'Sales',
        sessionId: 's',
        slug: 'pricing',
        mode: 'edit',
        title: 'Pricing',
        headline: 'Starter costs more',
        highlights: [{ label: 'Starter', before: '49', after: content }],
        type: 'offering',
        content,
        reason: 'New price',
        sources: [],
        baseHash: null,
        tags: [],
        spaceId: null,
        fingerprint: proposalFingerprint({ slug: 'pricing', content }),
    })
}

describe('brain routes', () => {
    it('seeds the brain and lists its pages', async () => {
        const res = await app.request(
            '/brain/seed',
            json('POST', {
                pages: [
                    { slug: 'company', title: 'Company', type: 'company', content: 'Acme sells widgets.' },
                    { slug: 'pricing', title: 'Pricing', type: 'offering', content: 'Starter is 49.', sources: ['site:pricing'] },
                ],
            })
        )
        expect(await res.json()).toEqual({ written: ['company', 'pricing'], skipped: [] })
        const list = (await (await app.request('/brain/pages')).json()) as { pages: { slug: string }[] }
        expect(list.pages.map(p => p.slug)).toEqual(['company', 'pricing'])
    })

    it('rejects a seed page with an invalid slug', async () => {
        const res = await app.request('/brain/seed', json('POST', { pages: [{ slug: 'Bad Slug', title: 'x', type: 'note', content: 'x' }] }))
        expect(res.status).toBe(400)
    })

    it('reads a page with its revisions, and 404s on a missing one', async () => {
        const res = await app.request('/brain/pages/pricing')
        const body = (await res.json()) as { page: { hash: string; sources: string[] }; revisions: { author: string }[] }
        expect(body.page.sources).toEqual(['site:pricing'])
        expect(body.revisions.map(r => r.author)).toEqual(['seed'])
        expect((await app.request('/brain/pages/missing')).status).toBe(404)
    })

    it('writes a human edit against the current hash and answers 409 on a stale one', async () => {
        const { page } = (await (await app.request('/brain/pages/pricing')).json()) as { page: { hash: string } }
        const edit = { title: 'Pricing', type: 'offering', content: 'Starter is 59.', sources: [], author: 'user:1' }
        const ok = await app.request('/brain/pages/pricing', json('PUT', { ...edit, baseHash: page.hash }))
        expect(ok.status).toBe(200)
        expect(((await ok.json()) as { page: { updatedBy: string } }).page.updatedBy).toBe('user:1')
        const stale = await app.request('/brain/pages/pricing', json('PUT', { ...edit, content: 'Starter is 69.', baseHash: page.hash }))
        expect(stale.status).toBe(409)
    })

    it('reads an old revision and reverts to it', async () => {
        const { revisions } = (await (await app.request('/brain/pages/pricing')).json()) as { revisions: { id: string; author: string }[] }
        const seeded = revisions.find(r => r.author === 'seed')!
        const read = (await (await app.request(`/brain/pages/pricing/revisions/${seeded.id}`)).json()) as { content: string }
        expect(read.content).toBe('Starter is 49.')
        expect((await app.request('/brain/pages/pricing/revisions/nope')).status).toBe(404)
        const reverted = (await (await app.request(`/brain/pages/pricing/revert/${seeded.id}`, json('POST', { author: 'user:2' }))).json()) as { page: { content: string } }
        expect(reverted.page.content).toBe('Starter is 49.')
    })

    it('reverts against the version the caller saw, and answers 409 once the page moved', async () => {
        const { page, revisions } = (await (await app.request('/brain/pages/pricing')).json()) as { page: { hash: string }; revisions: { id: string; author: string }[] }
        const edited = revisions.find(r => r.author === 'user:1')!
        const ok = await app.request(`/brain/pages/pricing/revert/${edited.id}`, json('POST', { author: 'user:2', expectedHash: page.hash }))
        expect(ok.status).toBe(200)
        expect(((await ok.json()) as { page: { content: string } }).page.content).toBe('Starter is 59.')
        const stale = await app.request(`/brain/pages/pricing/revert/${edited.id}`, json('POST', { author: 'user:2', expectedHash: page.hash }))
        expect(stale.status).toBe(409)
        expect(((await (await app.request('/brain/pages/pricing')).json()) as { page: { content: string } }).page.content).toBe('Starter is 59.')
    })

    it('confirms the sections the seed imported', async () => {
        const read = async () => ((await (await app.request('/brain/pages/company')).json()) as { page: { unconfirmed: string[] } }).page.unconfirmed
        expect(await read()).toEqual(['Overview'])
        const res = await app.request('/brain/pages/company/confirm', json('POST', { headings: null }))
        expect(((await res.json()) as { page: { unconfirmed: string[] } }).page.unconfirmed).toEqual([])
        expect(await read()).toEqual([])
        expect((await app.request('/brain/pages/missing/confirm', json('POST', { headings: null }))).status).toBe(404)
    })

    it('lists, counts, accepts and dismisses proposals', async () => {
        const a = await proposal('Starter is 79.')
        const b = await proposal('Starter is 89.')
        expect(await (await app.request('/brain/proposals/count')).json()).toEqual({ count: 2 })
        const listed = (await (await app.request('/brain/proposals?status=proposed')).json()) as { proposals: { id: string; headline: string | null; highlights: unknown[] }[] }
        expect(listed.proposals.map(p => p.id).sort()).toEqual([a.id, b.id].sort())
        expect(listed.proposals.find(p => p.id === a.id)).toMatchObject({ headline: 'Starter costs more', highlights: [{ label: 'Starter', before: '49', after: 'Starter is 79.' }] })

        const accepted = (await (await app.request(`/brain/proposals/${a.id}/accept`, json('POST', { decidedBy: 'user:1' }))).json()) as { proposal: { status: string } }
        expect(accepted.proposal.status).toBe('accepted')
        const dismissed = (await (await app.request(`/brain/proposals/${b.id}/dismiss`, json('POST', { decidedBy: 'user:1' }))).json()) as { proposal: { status: string } }
        expect(dismissed.proposal.status).toBe('dismissed')

        const all = (await (await app.request('/brain/proposals')).json()) as { proposals: unknown[] }
        expect(all.proposals).toHaveLength(2)
        expect((await app.request('/brain/proposals?status=weird')).status).toBe(400)
    })

    it('deletes a page', async () => {
        expect((await app.request('/brain/pages/company', { method: 'DELETE' })).status).toBe(200)
        expect((await app.request('/brain/pages/company', { method: 'DELETE' })).status).toBe(404)
    })
})

describe('filing routes', () => {
    it('files a page by hand and lists the filed files of the shared folder', async () => {
        await app.request('/brain/pages/filed-page', json('PUT', { title: 'Filed', type: 'note', content: 'Hello.', sources: [], baseHash: null, author: 'user:theo' }))
        const filed = await app.request('/brain/pages/filed-page/meta', json('PATCH', { tags: ['acme'], spaceId: 'box-sales' }))
        expect(filed.status).toBe(200)
        expect((await filed.json()).page).toMatchObject({ tags: ['acme'], spaceId: 'box-sales', createdBy: 'user:theo' })

        const boxes = await app.request('/brain/agent-boxes', json('PUT', { boxes: { 'agent-1': 'box-sales' } }))
        expect(boxes.status).toBe(200)

        const files = await app.request('/brain/files/meta', json('PUT', { paths: ['nowhere.pdf'], tags: ['x'], spaceId: null, author: 'user:theo' }))
        expect(await files.json()).toEqual({ files: [] })
        expect((await app.request('/brain/files/meta', json('PUT', { paths: [] }))).status).toBe(400)
    })
})
