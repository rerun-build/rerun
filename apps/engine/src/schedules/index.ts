import { listSchedules } from './loader.js'

// No next run here: it moves after every fire, and this index sits in the cached system prompt.
// schedule_list and schedule_get carry it.
export async function buildScheduleIndex(agentId: string): Promise<string> {
    const schedules = (await listSchedules(agentId)).filter(s => s.enabled).sort((a, b) => a.slug.localeCompare(b.slug))
    if (schedules.length === 0) return ''
    const lines = schedules.map(s => `- ${s.name} (slug: ${s.slug}): ${s.kind === 'script' ? 'script, ' : ''}${s.cron ? `cron ${s.cron}` : `once ${s.runAt}`}`)
    return `These routines run on a schedule. Manage them with the schedule_* tools, and read a routine's next run with schedule_get.\n\n${lines.join('\n')}`
}
