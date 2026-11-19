import { isSubscriptionEntitled } from './entitlement'

// A referral link is `/i/<code>`: kept apart from `ref` and `via`, which Affonso reads off any URL.
export const REFERRAL_PATH = '/i'

// Set by `/i/<code>` on a visitor without an account, read when that account is provisioned.
export const REFERRAL_COOKIE = 'rerun_referral'

export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

// The months a workspace can earn by referring. Past it, its link still gives each friend a month.
export const REFERRAL_MONTHS_CAP = 12

export const REFERRAL_MILESTONES = [1, 3, 6, 12] as const

export const REFERRAL_CODE_PATTERN = /^[a-z0-9-]{1,40}$/

export type ReferralStatus = 'signed_up' | 'trial' | 'subscribed' | 'canceled'

// The friends who earned a month first, the ones who left last.
export const REFERRAL_STATUS_ORDER: Record<ReferralStatus, number> = { subscribed: 0, trial: 1, signed_up: 2, canceled: 3 }

export type ReferralFriend = { id: string; name: string | null; email: string | null; status: ReferralStatus }

// The friends Refer a friend lists by name; the others are only counted.
export const REFERRAL_FRIENDS_SHOWN = 6

export type ReferralOverview = { link: string; monthsEarned: number; cap: number; friends: ReferralFriend[]; moreFriends: number }

// Read off the friend's workspace rather than stored: the reward is the only thing the referral keeps.
// A friend whose trial is spent without an entitled plan left before paying.
export function referralStatus(rewardedAt: string | null, workspace: { subscription_status: string | null; trial_ends_at: string | null } | null): ReferralStatus {
    if (rewardedAt) return 'subscribed'
    if (workspace?.subscription_status === 'trialing') return 'trial'
    if (workspace?.trial_ends_at && !isSubscriptionEntitled(workspace.subscription_status)) return 'canceled'
    return 'signed_up'
}

export function referralLink(origin: string, code: string): string {
    return `${origin.replace(/\/$/, '')}${REFERRAL_PATH}/${code}`
}
