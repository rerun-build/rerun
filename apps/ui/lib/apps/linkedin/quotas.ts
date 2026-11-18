import { defineQuotas, type QuotaLimit } from '@/lib/apps/quotas'

export { isoWeekKey } from '@/lib/apps/quotas'

// The pace recommended for one LinkedIn account through its coworkers. Lower than what Linkup calls
// safe for a seasoned paid account: the account that gets restricted is the user's own, and most
// connected accounts are neither paid nor warmed up. Past it the call still goes through.

export type QuotaAction = 'invitation' | 'message' | 'profile_view' | 'search_result' | 'content_read' | 'engagement' | 'post' | 'job_application' | 'attachment_download'

// Reads paid data can take over once the account is past its pace of the day.
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

const PAST_PACE = "Each one more raises the risk of LinkedIn restricting the user's own account. Tell the user once, in one line, with the count and that risk."
const USER_DECIDES = "Going on is the user's call: keep doing what they ask, never refuse it because of this pace."

export const { quotaLimits, quotaClaim, quotaNotice, quotaPace } = defineQuotas<QuotaAction>({
    envPrefix: 'LINKEDIN_QUOTA',
    limits: DEFAULT_QUOTAS,
    nouns: QUOTA_NOUNS,
    notice: (noun, overage, action) =>
        READ_ACTIONS.has(action)
            ? `This LinkedIn account is past its recommended ${noun} pace (${overage}). This call went through. ${PAST_PACE} If you have paid_data and it reads what the task still needs, offer it as the safer way. ${USER_DECIDES}`
            : `This LinkedIn account is past its recommended ${noun} pace (${overage}). This call went through. ${PAST_PACE} Let them choose between going on today and picking the rest up tomorrow. ${USER_DECIDES}`,
})
