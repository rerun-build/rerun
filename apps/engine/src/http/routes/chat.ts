import { chatRequestSchema, runGoalSchema, ENGINE_SESSION_NOT_FOUND, type SessionSource } from '@rerun/contracts'
import { Hono } from 'hono'
import { resolveRunModel } from '../../agents/availability.js'
import { getAgent } from '../../agents/registry.js'
import { claimInstallSession } from '../../agents/setup.js'
import { createSession, getSession } from '../../db/repos/sessions.js'
import { startRun } from '../../db/repos/runs.js'
import { agentDisabled } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { runAgent } from '../../runtime/loop.js'
import { claimSession, releaseSession, sessionClaim } from '../../runtime/run-control.js'
import { mergeRunStream } from '../../runtime/run-stream-merge.js'
import { toResumableStreamResponse } from '../../runtime/stream.js'

export const chatRoutes = new Hono()

async function resolveSession(agentId: string, sessionId: string | undefined, source: SessionSource) {
    if (sessionId) {
        const session = await getSession(agentId, sessionId)
        return session ?? null
    }
    return createSession(agentId, undefined, undefined, source)
}

chatRoutes.post('/chat', async c => {
    const agentId = c.req.param('id')!
    const agent = await getAgent(agentId)
    if (!agent.config.enabled) throw agentDisabled()
    const raw = await c.req.json()
    if (raw && typeof raw === 'object' && 'goal' in raw && !runGoalSchema.safeParse((raw as { goal: unknown }).goal).success) return c.json({ error: 'invalid_goal' }, 400)
    const body = chatRequestSchema.parse(raw)
    const briefedAgent = agent.config.kind === 'foreman' && body.foreman ? { ...agent, brief: body.foreman } : agent
    const runAgentView = body.thinkingLevel ? { ...briefedAgent, config: { ...briefedAgent.config, thinkingLevel: body.thinkingLevel } } : briefedAgent
    const source = body.source ?? 'dashboard'
    const claim = body.install && !body.sessionId ? await claimInstallSession(agentId, () => createSession(agentId, undefined, undefined, source)) : null
    if (claim && 'inFlight' in claim) return c.json({ error: 'the installation is already under way in another conversation', code: 'install_in_flight', sessionId: claim.inFlight }, 409)
    const session = claim ? claim.session : await resolveSession(agentId, body.sessionId, source)
    if (!session) return c.json({ error: ENGINE_SESSION_NOT_FOUND }, 404)
    const override = { connectionId: body.connectionId, provider: body.provider, model: body.model }
    const { provider, model } = await resolveRunModel(agent, override)
    const meta = { provider, model }
    const runId = newId()
    const holder = claimSession(session.id, runId, body.author?.id)
    if (holder) {
        const claim = sessionClaim(session.id)
        return c.json({ error: 'a run is already in flight on this session', code: 'run_in_flight', runId: holder, sessionId: session.id, startedAt: claim ? new Date(claim.claimedAt).toISOString() : null, authorId: claim?.authorId ?? null }, 409)
    }
    const run = await startRun(agent.id, session.id, runId).catch(err => {
        releaseSession(runId)
        throw err
    })
    const response = toResumableStreamResponse(run.id, async writer => {
        try {
            const agentRun = await runAgent(runAgentView, session.id, body.message, override, writer, run.id, { source: 'chat', author: body.author, userLanguage: claim ? body.userLanguage : undefined, callableAgentIds: body.callableAgentIds, goal: body.goal })
            mergeRunStream(writer, agentRun, meta)
        } catch (err) {
            releaseSession(run.id)
            throw err
        }
    })
    response.headers.set('x-session-id', session.id)
    response.headers.set('x-run-id', run.id)
    return response
})
