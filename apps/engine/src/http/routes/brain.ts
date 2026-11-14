import { Hono } from 'hono'
import { brainConfirmSectionsSchema, brainRevertSchema, brainPageWriteSchema, brainProposalAcceptSchema, brainProposalDismissSchema, brainProposalStatusSchema, brainSeedInputSchema } from '@rerun/contracts'
import { confirmSections, deletePage, getPage, getRevision, listPages, listRevisions, revertPage, writePage } from '../../brain/pages.js'
import { acceptProposal, countOpenProposals, dismissProposal, listProposals } from '../../brain/proposals.js'
import { seedBrain } from '../../brain/seed.js'
import { notFound } from '../../lib/errors.js'

export const brainRoutes = new Hono()

async function pageResponse(slug: string) {
    const page = await getPage(slug)
    if (!page) throw notFound('page')
    return { page, revisions: await listRevisions(slug) }
}

brainRoutes.get('/pages', async c => c.json({ pages: await listPages() }))

brainRoutes.get('/pages/:slug', async c => c.json(await pageResponse(c.req.param('slug'))))

brainRoutes.put('/pages/:slug', async c => {
    const slug = c.req.param('slug')
    const body = brainPageWriteSchema.parse(await c.req.json())
    await writePage(slug, body)
    return c.json(await pageResponse(slug))
})

brainRoutes.delete('/pages/:slug', async c => {
    await deletePage(c.req.param('slug'))
    return c.json({ ok: true })
})

brainRoutes.get('/pages/:slug/revisions/:rid', async c => {
    const found = await getRevision(c.req.param('slug'), c.req.param('rid'))
    if (!found) throw notFound('revision')
    return c.json(found)
})

brainRoutes.post('/pages/:slug/revert/:rid', async c => {
    const slug = c.req.param('slug')
    const { author, expectedHash } = brainRevertSchema.parse(await c.req.json())
    await revertPage(slug, c.req.param('rid'), author, expectedHash)
    return c.json(await pageResponse(slug))
})

brainRoutes.post('/pages/:slug/confirm', async c => {
    const slug = c.req.param('slug')
    const { headings } = brainConfirmSectionsSchema.parse(await c.req.json())
    await confirmSections(slug, headings)
    return c.json(await pageResponse(slug))
})

brainRoutes.get('/proposals', async c => {
    const status = brainProposalStatusSchema.optional().parse(c.req.query('status') || undefined)
    return c.json({ proposals: await listProposals(status) })
})

brainRoutes.get('/proposals/count', async c => c.json({ count: await countOpenProposals() }))

brainRoutes.post('/proposals/:pid/accept', async c => {
    const { decidedBy, ...edits } = brainProposalAcceptSchema.parse(await c.req.json())
    return c.json({ proposal: await acceptProposal(c.req.param('pid'), decidedBy, edits) })
})

brainRoutes.post('/proposals/:pid/dismiss', async c => {
    const { decidedBy } = brainProposalDismissSchema.parse(await c.req.json())
    return c.json({ proposal: await dismissProposal(c.req.param('pid'), decidedBy) })
})

brainRoutes.post('/seed', async c => {
    const { pages } = brainSeedInputSchema.parse(await c.req.json())
    return c.json(await seedBrain(pages))
})
