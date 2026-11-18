import { defineQuotas, type QuotaLimit } from '@/lib/apps/quotas'

// The pace recommended for one WhatsApp number through its coworkers, which never refuses a call.
// WhatsApp bans a number for unsolicited messages far faster than LinkedIn restricts a profile: a
// first message to somebody counts twice, once as a message and once as a new conversation, the pace
// that matters.

export type QuotaAction = 'message' | 'new_conversation' | 'number_check' | 'attachment_download'

const DEFAULT_QUOTAS: Record<QuotaAction, QuotaLimit[]> = {
    message: [{ window: 'day', max: 100 }],
    new_conversation: [{ window: 'day', max: 20 }],
    number_check: [{ window: 'day', max: 500 }],
    attachment_download: [{ window: 'day', max: 200 }],
}

const QUOTA_NOUNS: Record<QuotaAction, string> = {
    message: 'message',
    new_conversation: 'new conversation',
    number_check: 'number check',
    attachment_download: 'attachment download',
}

export const { quotaLimits, quotaClaim, quotaNotice, quotaPace } = defineQuotas<QuotaAction>({
    envPrefix: 'WHATSAPP_QUOTA',
    limits: DEFAULT_QUOTAS,
    nouns: QUOTA_NOUNS,
    notice: (noun, overage) =>
        `This WhatsApp number is past its recommended ${noun} pace (${overage}). This call went through. Each one more raises the risk of WhatsApp banning the number. Tell the user once, in one line, with the count and that risk, and let them choose between going on today and picking the rest up tomorrow. Going on is the user's call: keep doing what they ask, never refuse it because of this pace.`,
})
