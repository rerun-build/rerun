import { defineQuotas, type QuotaLimit } from '@/lib/apps/quotas'

export { isoWeekKey } from '@/lib/apps/quotas'

// What one LinkedIn account may do through its coworkers. Lower than what Linkup calls safe for a
// seasoned paid account: the account that gets restricted is the user's own, and most connected
// accounts are neither paid nor warmed up.

export type QuotaAction = 'invitation' | 'message' | 'profile_view' | 'search_result' | 'engagement' | 'post' | 'job_application' | 'attachment_download'

const DEFAULT_QUOTAS: Record<QuotaAction, QuotaLimit[]> = {
    invitation: [
        { window: 'day', max: 25 },
        { window: 'week', max: 150 },
    ],
    message: [{ window: 'day', max: 40 }],
    profile_view: [{ window: 'day', max: 100 }],
    search_result: [{ window: 'day', max: 1000 }],
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
    engagement: 'reaction and comment',
    post: 'post',
    job_application: 'job application',
    attachment_download: 'attachment download',
}

export const { quotaLimits, quotaClaim, quotaRefusal } = defineQuotas<QuotaAction>({
    envPrefix: 'LINKEDIN_QUOTA',
    limits: DEFAULT_QUOTAS,
    nouns: QUOTA_NOUNS,
    refusal: (noun, windows) =>
        `The ${noun} limit of this LinkedIn account is reached (${windows}). It protects the account from a LinkedIn restriction. Do not retry today: tell the user and pick the work up again tomorrow.`,
})
