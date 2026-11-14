import { automationModel } from '../agents/availability.js'
import { getAgent } from '../agents/registry.js'
import { createSession } from '../db/repos/sessions.js'
import { markFired, type Trigger } from '../triggers/loader.js'
import { startHeadlessRun } from './headless-run.js'
import { sendNotification } from './notify.js'
import { isBudgetLatched } from './budget-latch.js'
import { nowIso } from '../lib/ids.js'
import { agentDisabled, budgetExhausted } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export async function fireTrigger(agentId: string, trigger: Trigger, message: string): Promise<{ runId: string; sessionId: string }> {
    const agent = await getAgent(agentId)
    if (!agent.config.enabled) throw agentDisabled()
    const override = await automationModel(agent, trigger, 'trigger')
    if (override.provider === 'rerun' && isBudgetLatched()) throw budgetExhausted()
    const session = await createSession(agentId, `trigger: ${trigger.slug}`, undefined, 'trigger')
    await sendNotification({
        event: 'agent.session.created',
        kind: 'info',
        agentId,
        sessionId: session.id,
        runId: null,
        message: `Triggered run: ${trigger.name}`,
        title: trigger.name,
        source: 'trigger',
    })
    void markFired(agentId, trigger.slug, nowIso()).catch(err => logger.warn({ agent: agentId, trigger: trigger.slug, err: String(err) }, 'markFired failed'))
    const { runId, settled } = await startHeadlessRun(agent, session.id, message, override, { source: 'trigger', slug: trigger.slug, name: trigger.name })

    logger.info({ agent: agentId, trigger: trigger.slug, runId, session: session.id }, 'triggered run fired')

    void settled.then(outcome => {
        if (outcome.kind === 'error') logger.error({ agent: agentId, trigger: trigger.slug, err: outcome.error }, 'triggered run failed')
    })

    return { runId, sessionId: session.id }
}
