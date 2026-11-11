import { HITL_CANCELLED, type ApprovalDecision, type QuestionAnswer, type ServiceSetupEntry } from '@rerun/contracts'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

function ReceiptCard({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ alignSelf: 'flex-end', width: '86%', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: theme.muted }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm }}>
                <AppText variant="caption" medium>
                    {title}
                </AppText>
                {count && (
                    <AppText variant="caption" tone="muted">
                        {count}
                    </AppText>
                )}
            </View>
            {children}
        </View>
    )
}

// The answers sent to a question block, drawn back instead of the text written for the coworker.
export function QuestionReceipt({ answers }: { answers: QuestionAnswer[] }) {
    const t = useTranslations('mobileHitl.receipts')
    const theme = useTheme()
    const answered = answers.filter(answer => answer.answers.length > 0 || (answer.attachments?.length ?? 0) > 0).length
    return (
        <ReceiptCard title={answers.length > 1 ? t('answers') : t('answer')} count={answers.length > 1 ? t('answeredCount', { answered, total: answers.length }) : undefined}>
            {answers.map((answer, index) => (
                <View key={index} style={{ gap: 2 }}>
                    <AppText variant="footnote" tone="muted">
                        {answer.question}
                    </AppText>
                    {answer.answers.length === 0 ? (
                        <AppText variant="body" tone="muted" style={{ fontStyle: 'italic' }}>
                            {t('skipped')}
                        </AppText>
                    ) : (
                        answer.answers.map(value => (
                            <View key={value} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                                <Icon name="check" size={11} bold color={theme.foreground} />
                                <AppText variant="body" style={{ flexShrink: 1 }}>
                                    {value}
                                </AppText>
                            </View>
                        ))
                    )}
                </View>
            ))}
        </ReceiptCard>
    )
}

export function CancelledReceipt({ of }: { of: keyof typeof HITL_CANCELLED }) {
    const t = useTranslations('mobileHitl.receipts.cancelled')
    const theme = useTheme()
    return (
        <View style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Icon name="x" size={11} bold color={theme.mutedForeground} />
            <AppText variant="footnote" tone="muted">
                {t(of)}
            </AppText>
        </View>
    )
}

function Decision({ approved, label }: { approved: boolean; label: string }) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name={approved ? 'check' : 'x'} size={10} bold color={approved ? theme.foreground : theme.destructive} />
            <AppText variant="caption" medium tone={approved ? 'default' : 'destructive'}>
                {label}
            </AppText>
        </View>
    )
}

function DecidedRow({ text, approved, label, note }: { text: string; approved: boolean; label: string; note?: string }) {
    const t = useTranslations('mobileHitl.receipts')
    return (
        <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }}>
                <AppText variant="body" tone={approved ? 'default' : 'muted'} style={{ flexShrink: 1, textDecorationLine: approved ? 'none' : 'line-through' }}>
                    {text}
                </AppText>
                <Decision approved={approved} label={label} />
            </View>
            {note && (
                <AppText variant="footnote" tone="muted">
                    {t('quotedNote', { note })}
                </AppText>
            )}
        </View>
    )
}

export function ApprovalReceipt({ decisions }: { decisions: Omit<ApprovalDecision, 'detail'>[] }) {
    const t = useTranslations('mobileHitl.receipts')
    const approved = decisions.filter(entry => entry.decision === 'approved').length
    return (
        <ReceiptCard title={decisions.length > 1 ? t('approvals') : t('approval')} count={decisions.length > 1 ? t('approvalCount', { approved, declined: decisions.length - approved }) : undefined}>
            {decisions.map((entry, index) => (
                <DecidedRow key={index} text={entry.action} approved={entry.decision === 'approved'} label={entry.decision === 'approved' ? t('approved') : t('notNow')} note={entry.note} />
            ))}
        </ReceiptCard>
    )
}

const SERVICE_STATUS = {
    connected: { approved: true, label: 'connected' },
    skipped: { approved: false, label: 'skipped' },
    reset: { approved: false, label: 'notReconnected' },
    'not-found': { approved: false, label: 'notFound' },
} as const satisfies Record<ServiceSetupEntry['outcome'], { approved: boolean; label: string }>

function StatusRow({ text, approved, label }: { text: string; approved: boolean; label: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
            <AppText variant="body" style={{ flexShrink: 1 }}>
                {text}
            </AppText>
            <Decision approved={approved} label={label} />
        </View>
    )
}

export function ServiceReceipt({ entries }: { entries: ServiceSetupEntry[] }) {
    const t = useTranslations('mobileHitl.receipts')
    const connected = entries.filter(entry => entry.outcome === 'connected').length
    return (
        <ReceiptCard title={t('apps')} count={t('appsConnected', { connected, total: entries.length })}>
            {entries.map((entry, index) => (
                <StatusRow key={index} text={entry.replaces ? t('instead', { name: entry.name, replaced: entry.replaces }) : entry.name} approved={SERVICE_STATUS[entry.outcome].approved} label={t(SERVICE_STATUS[entry.outcome].label)} />
            ))}
        </ReceiptCard>
    )
}

export function SecretReceipt({ entries }: { entries: { key: string; provided: boolean }[] }) {
    const t = useTranslations('mobileHitl.receipts')
    const stored = entries.filter(entry => entry.provided).length
    return (
        <ReceiptCard title={t('keys')} count={t('keysStored', { stored, total: entries.length })}>
            {entries.map(entry => (
                <StatusRow key={entry.key} text={entry.key} approved={entry.provided} label={entry.provided ? t('stored') : t('skipped')} />
            ))}
            <AppText variant="footnote" tone="muted">
                {t('storedOnBox')}
            </AppText>
        </ReceiptCard>
    )
}

export function McpReceipt({ name }: { name: string }) {
    const t = useTranslations('mobileHitl.receipts')
    return (
        <ReceiptCard title={t('mcpServer')}>
            <StatusRow text={name} approved label={t('connected')} />
        </ReceiptCard>
    )
}

export function TakeoverReceipt({ url }: { url: string | null }) {
    const t = useTranslations('mobileHitl.receipts')
    const theme = useTheme()
    return (
        <View style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '86%' }}>
            <Icon name="monitor" size={11} bold color={theme.mutedForeground} />
            <AppText variant="footnote" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {url ? t('handedBackOn', { url }) : t('handedBack')}
            </AppText>
        </View>
    )
}
