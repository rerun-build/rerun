import { isPaidSubscription } from '@moldwright/cloud/billing'

type LockableAgent = { templateId: string | null }
type LockableWorkspace = { subscription_status: string | null; is_sandbox: boolean } | null | undefined

export function isTemplateContentLocked(agent: LockableAgent, workspace: LockableWorkspace): boolean {
    if (!agent.templateId) return false
    if (workspace?.is_sandbox) return false
    return !isPaidSubscription(workspace?.subscription_status)
}

export function templateLockTooltip(action: string): string {
    return `${action} unlocks once your workspace is on a paid plan.`
}

export type LockedContentKind = 'skill' | 'soul' | 'schedule' | 'trigger' | 'file'

const LOREM = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
]

const HEADINGS: Record<LockedContentKind, string> = {
    skill: '# Procedure',
    soul: '# System prompt',
    schedule: '# Task prompt',
    trigger: '# Webhook prompt',
    file: '# Reference',
}

export function lockedPlaceholder(kind: LockedContentKind, realLength: number): string {
    const target = Math.min(2000, Math.max(400, Math.ceil(realLength / 400) * 400))
    const lines: string[] = [HEADINGS[kind], '']
    let length = lines.join('\n').length
    for (let i = 0; length < target; i++) {
        const line = LOREM[i % LOREM.length]
        lines.push(line, '')
        length += line.length + 2
    }
    return lines.join('\n')
}
