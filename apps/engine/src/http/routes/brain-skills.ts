import { Hono } from 'hono'
import { brainSkillCreateSchema, brainSkillShareSchema, brainSkillUpdateSchema } from '@rerun/contracts'
import { agentExists } from '../../agents/loader.js'
import { notFound } from '../../lib/errors.js'
import { createBrainSkill, deleteBrainSkill, listBrainSkills, readBrainSkill, shareAgentSkillToBrain, updateBrainSkill } from '../../skills/brain.js'

// The skills of the Brain, used by every coworker. Like the pages, the hub is the only caller and
// passes who the person is as the author.
export const brainSkillRoutes = new Hono()

brainSkillRoutes.get('/', async c => c.json({ skills: await listBrainSkills() }))

brainSkillRoutes.post('/', async c => {
    const input = brainSkillCreateSchema.parse(await c.req.json())
    return c.json(await createBrainSkill(input), 201)
})

brainSkillRoutes.post('/share', async c => {
    const input = brainSkillShareSchema.parse(await c.req.json())
    if (!agentExists(input.agentId)) throw notFound('agent')
    return c.json(await shareAgentSkillToBrain(input.agentId, input.slug, input.author), 201)
})

brainSkillRoutes.get('/:slug', async c => c.json(await readBrainSkill(c.req.param('slug'))))

brainSkillRoutes.patch('/:slug', async c => {
    const patch = brainSkillUpdateSchema.parse(await c.req.json())
    return c.json(await updateBrainSkill(c.req.param('slug'), patch))
})

brainSkillRoutes.delete('/:slug', async c => {
    await deleteBrainSkill(c.req.param('slug'))
    return c.body(null, 204)
})
