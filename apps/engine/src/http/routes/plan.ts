import { Hono } from 'hono'
import { boxPlanSchema } from '@moldwright/contracts'
import { readBoxPlan, writeBoxPlan } from '../../connections/plan.js'

export const planRoutes = new Hono()

planRoutes.get('/', c => c.json(readBoxPlan()))

planRoutes.put('/', async c => c.json(await writeBoxPlan(boxPlanSchema.parse(await c.req.json()))))
