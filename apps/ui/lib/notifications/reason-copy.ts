import type { EmailTranslator } from '@rerun/emails/i18n'
import type { NotificationReason } from './routing'

export type ReasonCopy = (key: 'mine' | 'participant' | 'followed' | 'allActivity' | 'everything' | 'workspace', values?: { agentName: string }) => string

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
