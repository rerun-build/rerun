import type { EmailTranslator } from '@rerun/emails/i18n'
import type { NotificationReason } from './routing'

// The `notifications.inbox.reasons` catalog.
export type ReasonCopy = (key: 'mine' | 'participant' | 'followed' | 'allActivity' | 'everything' | 'workspace', values?: { agentName: string }) => string

// The line under an inbox row: why this reached you.
export function reasonSentence(reason: NotificationReason, agentName: string, t: ReasonCopy): string {
    switch (reason) {
        case 'mine':
            return t('mine')
        case 'participant':
            return t('participant')
        case 'followed':
            return t('followed', { agentName })
        case 'all_activity':
            return t('allActivity', { agentName })
        case 'everything':
            return t('everything')
        case 'workspace':
            return t('workspace')
    }
}

// The same sentence in the email's language, closed by a full stop. The translator is handed in so
// the inbox never bundles the email packs.
export function emailReasonSentence(reason: NotificationReason, agentName: string, t: EmailTranslator): string {
    switch (reason) {
        case 'mine':
            return t('reasons.mine')
        case 'participant':
            return t('reasons.participant')
        case 'followed':
            return t('reasons.followed', { agentName })
        case 'all_activity':
            return t('reasons.allActivity', { agentName })
        case 'everything':
            return t('reasons.everything')
        case 'workspace':
            return t('reasons.workspace')
    }
}
