import { CoinsIcon, CpuIcon, UserPlus, type LucideIcon } from '@/lib/icons'

import { BASE_PLAN_CREDITS, CREDITS_PER_PACK, TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, creditsLabel } from './plans'

export type ProPerk = { id: string; icon: LucideIcon; title: string; trial: string; pro: string; headline: string }

// What paying changes, against what the trial gives. Models are not one of them: a trial runs every one.
export const PRO_PERKS: ProPerk[] = [
    { id: 'credits', icon: CoinsIcon, title: 'AI usage', trial: `${creditsLabel(TRIAL_CREDITS)}, once`, pro: `${creditsLabel(BASE_PLAN_CREDITS)} every month`, headline: `${BASE_PLAN_CREDITS.toLocaleString('en-US')} credits/mo` },
    { id: 'coworkers', icon: CpuIcon, title: 'Coworkers', trial: `${TRIAL_ACTIVE_AGENTS} active`, pro: 'Unlimited', headline: 'Unlimited coworkers' },
    { id: 'team', icon: UserPlus, title: 'Teammates', trial: 'Just you', pro: 'Invite your whole team', headline: 'Invite your team' },
    { id: 'topup', icon: CoinsIcon, title: 'Top-ups', trial: 'Not available', pro: `+${creditsLabel(CREDITS_PER_PACK)} when you need them`, headline: 'Top-ups anytime' },
]

export const NOTICE_PERKS = PRO_PERKS.slice(0, 3)
