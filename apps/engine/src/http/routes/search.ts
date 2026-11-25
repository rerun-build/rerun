import { Hono } from 'hono'
import { workspaceSearchQuerySchema } from '@rerun/contracts'
import { searchWorkspace } from '../../search/workspaceSearch.js'

export const searchRoutes = new Hono()

// The hub is the only caller: it has checked the person belongs to the workspace, and `agents` lists
// the coworkers they may reach. What the workspace shares (its files, tables, Brain) is searched for everyone.
searchRoutes.get('/', async c => {
    const parsed = workspaceSearchQuerySchema.safeParse({ q: c.req.query('q'), agents: c.req.query('agents') })
    if (!parsed.success) return c.json({ error: 'invalid search query' }, 400)
    return c.json(await searchWorkspace(parsed.data.q, parsed.data.agents))
})
