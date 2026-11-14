import type { EngineAgentDetail, EngineSchedule, EngineSkill, EngineTrigger } from '@/lib/engine/types'
import { lockedPlaceholder } from '@/lib/templates/content-lock'

export const LOCKED_DOWNLOAD_ERROR = 'Upgrade your plan to download this skill.'
export const LOCKED_WRITE_ERROR = 'Upgrade your plan to edit this content.'

export const LOCKED_NOTICE =
    'This content came from a template: reading it is locked until the workspace has an active paid plan. The coworker itself works normally: to get this work done, ask it with send_message rather than doing it yourself.'

export function sealSkill(skill: EngineSkill, locked: boolean): EngineSkill & { locked: boolean } {
    if (!locked) return { ...skill, locked: false }
    return { ...skill, body: lockedPlaceholder('skill', skill.body.length), locked: true }
}

export function sealSkillFile(page: { content: string; truncated: boolean }, locked: boolean): { content: string; truncated: boolean; locked: boolean } {
    if (!locked) return { ...page, locked: false }
    return { content: lockedPlaceholder('file', page.content.length), truncated: false, locked: true }
}

export function sealAgentDetail(detail: EngineAgentDetail, locked: boolean): EngineAgentDetail {
    if (!locked) return detail
    return { ...detail, soul: lockedPlaceholder('soul', detail.soul.length) }
}

export function sealSchedule<T extends EngineSchedule>(schedule: T, locked: boolean): T {
    if (!locked) return schedule
    return { ...schedule, body: lockedPlaceholder('schedule', schedule.body.length) }
}

export function sealTrigger<T extends EngineTrigger>(trigger: T, locked: boolean): T {
    if (!locked) return trigger
    return { ...trigger, body: lockedPlaceholder('trigger', trigger.body.length) }
}
