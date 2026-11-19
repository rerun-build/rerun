import type { ActivatedAutomations } from '@moldwright/contracts'
import { listSchedules, setScheduleEnabled } from '../schedules/loader.js'
import { listTriggers, setTriggerEnabled } from '../triggers/loader.js'
import { nowIso } from '../lib/ids.js'
import { logger } from '../lib/logger.js'
import type { LoadedAgent } from './types.js'

export async function activateAutomations(agent: LoadedAgent): Promise<ActivatedAutomations> {
    const activated: ActivatedAutomations = { schedules: [], triggers: [] }
    if (!agent.config.enabled) return activated

    const now = nowIso()

    for (const schedule of await listSchedules(agent.id).catch(() => [])) {
        if (schedule.enabled) continue
        if (schedule.runAt && new Date(schedule.runAt).getTime() <= Date.now()) continue
        try {
            await setScheduleEnabled(agent.id, schedule.slug, true, schedule.cron ? now : undefined)
            activated.schedules.push(schedule.slug)
        } catch (err) {
            logger.warn({ agentId: agent.id, schedule: schedule.slug, err: String(err) }, 'schedule activation failed')
        }
    }

    for (const trigger of await listTriggers(agent.id).catch(() => [])) {
        if (trigger.enabled) continue
        try {
            await setTriggerEnabled(agent.id, trigger.slug, true)
            activated.triggers.push(trigger.slug)
        } catch (err) {
            logger.warn({ agentId: agent.id, trigger: trigger.slug, err: String(err) }, 'trigger activation failed')
        }
    }

    if (activated.schedules.length > 0 || activated.triggers.length > 0) {
        logger.info({ agentId: agent.id, ...activated }, 'automations activated')
    }

    return activated
}
