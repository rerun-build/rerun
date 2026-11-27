import { FOREMAN_AGENT_ID, FOREMAN_INSTRUCTIONS_MAX, parseForemanInstructions } from '@rerun/contracts'
import { Hono } from 'hono'
import { z } from 'zod'
import { readMemberInstructions, saveMemberInstructions } from '../../db/repos/members.js'
import { badRequest, notFound } from '../../lib/errors.js'

// The people of the workspace, as the Chief of Staff keeps them. The hub names the member: it is the
// only caller, and it passes the person signed in, never one a browser chose.
export const memberRoutes = new Hono()

const memberIdSchema = z.string().min(1).max(64)

function memberOf(c: { req: { param: (name: string) => string | undefined } }): string {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) throw notFound('Members')
    const parsed = memberIdSchema.safeParse(c.req.param('memberId'))
    if (!parsed.success) throw badRequest('A member id is 1 to 64 characters.')
    return parsed.data
}

memberRoutes.get('/:memberId/instructions', async c => c.json({ instructions: await readMemberInstructions(memberOf(c)) }))

memberRoutes.put('/:memberId/instructions', async c => {
    const memberId = memberOf(c)
    const body = (await c.req.json().catch(() => null)) as { instructions?: unknown } | null
    const parsed = parseForemanInstructions(body?.instructions)
    if (!parsed.ok) throw badRequest(parsed.reason === 'tooLong' ? `Instructions are at most ${FOREMAN_INSTRUCTIONS_MAX} characters.` : 'instructions must be a text or null.')
    await saveMemberInstructions(memberId, parsed.instructions)
    return c.json({ instructions: parsed.instructions })
})
