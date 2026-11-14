import { isPhoneStepDone, type PhoneStatus } from '@rerun/cloud/phone'
import type { WorkspaceDialogPanel } from '@/lib/settings/panels'
import { BILLING_ENABLED } from '@rerun/cloud/billing'

export const GETTING_STARTED_REWARD_DAYS = 3

export type GettingStartedStep = {
    id: 'phone' | 'first_agent' | 'ai_provider' | 'invite' | 'schedule' | 'payment_method'
    prompt?: string
    panel?: WorkspaceDialogPanel
    providers?: readonly string[]
}

export type GettingStartedStepId = GettingStartedStep['id']

export type GettingStartedProgress = Record<Exclude<GettingStartedStepId, 'phone'>, boolean> & { phone: boolean | null }

export type GettingStartedReward = 'available' | 'granted' | null

export type GettingStartedState = { progress: GettingStartedProgress; reward: GettingStartedReward }

export const GETTING_STARTED_STEPS: readonly GettingStartedStep[] = [
    { id: 'phone' },
    {
        id: 'first_agent',
        prompt: 'Help me create my first coworker',
    },
    {
        id: 'ai_provider',
        prompt: 'Help me connect my Claude or ChatGPT subscription, or an API key',
        panel: 'ai_providers',
        providers: ['anthropic', 'openai', 'google', 'openrouter'],
    },
    {
        id: 'invite',
        prompt: 'Help me invite a teammate to my workspace',
        panel: 'members',
    },
    {
        id: 'schedule',
        prompt: 'Schedule a recurring task for one of my coworkers',
    },
    { id: 'payment_method' },
]

export const NO_PROGRESS: GettingStartedProgress = { phone: null, first_agent: false, ai_provider: false, invite: false, schedule: false, payment_method: false }

export function stepsOf(progress: GettingStartedProgress): readonly GettingStartedStep[] {
    return GETTING_STARTED_STEPS.filter(step => progress[step.id] !== null && (BILLING_ENABLED || step.id !== 'payment_method'))
}

export function doneCount(progress: GettingStartedProgress): number {
    return stepsOf(progress).filter(step => progress[step.id]).length
}

export function nextStep(progress: GettingStartedProgress): GettingStartedStep | null {
    return stepsOf(progress).find(step => !progress[step.id]) ?? null
}

export function isComplete(progress: GettingStartedProgress): boolean {
    return stepsOf(progress).every(step => progress[step.id])
}

export const GETTING_STARTED_ITEMS = ['first_agent', 'ai_provider', 'invite', 'schedule', 'payment_method', 'reward', 'dismissed'] as const
export type GettingStartedItem = (typeof GETTING_STARTED_ITEMS)[number]

export function progressOf(items: ReadonlySet<string>, phone: PhoneStatus | null): GettingStartedProgress {
    return {
        phone: phone === null || phone === 'none' ? null : isPhoneStepDone(phone),
        first_agent: items.has('first_agent'),
        ai_provider: items.has('ai_provider'),
        invite: items.has('invite'),
        schedule: items.has('schedule'),
        payment_method: items.has('payment_method'),
    }
}

export function rewardOf(items: ReadonlySet<string>, workspace: { subscription_status: string | null; trial_ends_at: string | null }): GettingStartedReward {
    if (items.has('reward')) return 'granted'
    return workspace.subscription_status === 'trialing' && workspace.trial_ends_at ? 'available' : null
}
