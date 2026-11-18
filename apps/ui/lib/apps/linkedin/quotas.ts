import { defineQuotas, type QuotaLimit } from '@/lib/apps/quotas'

export { isoWeekKey } from '@/lib/apps/quotas'

// What one LinkedIn account may do through its coworkers. Lower than what Linkup calls safe for a
// seasoned paid account: the account that gets restricted is the user's own, and most connected
// accounts are neither paid nor warmed up.

export type QuotaAction = 'invitation' | 'message' | 'profile_view' | 'search_result' | 'content_read' | 'engagement' | 'post' | 'job_application' | 'attachment_download'

// Reads paid data can take over once the account's share of the day is spent.
const READ_ACTIONS: ReadonlySet<QuotaAction> = new Set(['profile_view', 'search_result', 'content_read'])

const DEFAULT_QUOTAS: Record<QuotaAction, QuotaLimit[]> = {
    invitation: [
        { window: 'day', max: 25 },
        { window: 'week', max: 150 },
    ],
    message: [{ window: 'day', max: 40 }],
    profile_view: [{ window: 'day', max: 100 }],
    search_result: [{ window: 'day', max: 1000 }],
    // Calls, not rows: Linkup's ~100 a day for the routes with no limit of their own.
    content_read: [{ window: 'day', max: 100 }],
    engagement: [{ window: 'day', max: 100 }],
    post: [{ window: 'day', max: 5 }],
    job_application: [{ window: 'day', max: 15 }],
    attachment_download: [{ window: 'day', max: 200 }],
}

const QUOTA_NOUNS: Record<QuotaAction, string> = {
    invitation: 'invitation',
    message: 'message',
    profile_view: 'profile view',
    search_result: 'search result',
    content_read: 'post, comment and reaction read',
    engagement: 'reaction and comment',
    post: 'post',
    job_application: 'job application',
    attachment_download: 'attachment download',
}

export const { quotaLimits, quotaClaim, quotaRefusal } = defineQuotas<QuotaAction>({
    envPrefix: 'LINKEDIN_QUOTA',
    limits: DEFAULT_QUOTAS,
    nouns: QUOTA_NOUNS,
    refusal: (noun, windows, action) =>
        READ_ACTIONS.has(action)
            ? `The ${noun} limit of this LinkedIn account is reached (${windows}). It protects the account from a LinkedIn restriction: read no more of it with this account today. If you have paid_data and it reads what the task still needs, offer it to the user and say why; otherwise tell the user and pick the work up again tomorrow.`
            : `The ${noun} limit of this LinkedIn account is reached (${windows}). It protects the account from a LinkedIn restriction. Do not retry today: tell the user and pick the work up again tomorrow.`,
})
