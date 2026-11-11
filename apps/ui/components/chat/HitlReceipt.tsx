'use client'

import { readSpendQuote } from '@rerun/contracts'
import { Badge, PANEL_CARD, type BadgeTone } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'

import { getServiceAlternativesAction } from '@/app/api/_actions/services.actions'
import type { ReadChatFile } from '@/components/chat/AttachmentLightbox'
import { MessageAttachments } from '@/components/chat/MessageAttachments'
import { SpendReceipt } from '@/components/chat/spend/SpendReceipt'
import { Icon } from '@/components/ui/icon'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { pendingApprovals, pendingQuestions, pendingSecrets, pendingServices, type HitlReply, type QuestionAnswer, type ServiceSetupEntry, type ServiceSetupOutcome } from '@/lib/chat-hitl'
import { humanizeToolSegment } from '@/lib/chat/connector-tools'
import { hitlCallInput, type HitlCallPart } from '@/lib/chat/hitl-receipts'
import type { RawUrlFor } from '@/lib/files/raw-url'
import { CheckIcon, KeyIcon, LinkIcon, MessageCircleQuestionIcon, MonitorIcon, PlugIcon, ShieldCheckIcon, XIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'

const USER_SIDE = 'ml-auto w-full max-w-[85%]'

type HitlReceiptProps = {
    reply: HitlReply
    // The call the reply answers, when the thread still holds it: it adds what the reply text drops
    // (icons, key labels, approval details, the options a question offered).
    call?: HitlCallPart
    spentMicros?: number
    spendRunning?: boolean
    agentId?: string
    rawUrlFor?: RawUrlFor
    readFile?: ReadChatFile
}

// What the user decided in a setup block, drawn in place of the reply written for the agent.
export function HitlReceipt({ reply, call, spentMicros = 0, spendRunning = false, agentId, rawUrlFor, readFile }: HitlReceiptProps) {
    const input = hitlCallInput(call)
    switch (reply.kind) {
        case 'service':
            return reply.entries.length > 0 ? <ServicesReceipt entries={reply.entries} askedSlugs={pendingServices(input).map(service => service.slug)} /> : null
        case 'question':
            return <AnswersReceipt answers={reply.answers} input={call ? input : null} agentId={agentId} rawUrlFor={rawUrlFor} readFile={readFile} />
        case 'secret':
            return <SecretsReceipt entries={reply.entries} labels={new Map(pendingSecrets(input).map(secret => [secret.key, secret.label]))} />
        case 'approval':
            return <ApprovalsReceipt decisions={reply.decisions} details={call ? new Map(pendingApprovals(input).map(item => [item.action, item.detail])) : new Map()} />
        case 'mcp':
            return <McpSignInReceipt agentId={agentId} name={reply.name} />
        case 'takeover':
            return <TakeoverReceipt url={reply.url} />
        case 'spend':
            return <SpendReceipt decision={reply} totalMicros={readSpendQuote(call?.output)?.totalMicros ?? null} progress={{ spentMicros, running: spendRunning }} />
        case 'cancelled':
            return <DismissedLine of={reply.of} />
    }
}

function ReceiptCard({ icon: Glyph, title, meta, children }: { icon: ComponentType<{ className?: string }>; title: string; meta?: string; children: ReactNode }) {
    return (
        <div className={cn(PANEL_CARD, USER_SIDE, 'overflow-hidden')}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
                <Glyph className="size-3.5 text-muted-foreground" />
                <span className="font-medium text-foreground">{title}</span>
                {meta && <span className="ml-auto text-muted-foreground">{meta}</span>}
            </div>
            <div className="divide-y divide-border">{children}</div>
        </div>
    )
}

const SERVICE_STATUS: Record<ServiceSetupOutcome, { labelKey: 'connected' | 'skipped' | 'notReconnected' | 'notFound'; tone: BadgeTone }> = {
    connected: { labelKey: 'connected', tone: 'green' },
    skipped: { labelKey: 'skipped', tone: 'neutral' },
    reset: { labelKey: 'notReconnected', tone: 'orange' },
    'not-found': { labelKey: 'notFound', tone: 'red' },
}

// The reply names an app picked as an alternative but not its slug, so its icon is found among the
// alternatives of the apps the agent asked for.
function useAlternativeIcons(slugs: string[]): Map<string, string> {
    const key = slugs.join(',')
    const [icons, setIcons] = useState(new Map<string, string>())
    useEffect(() => {
        if (!key) return
        let alive = true
        void getServiceAlternativesAction(key.split(',')).then(bySlug => {
            if (!alive) return
            const alternatives = Object.values(bySlug).flat()
            setIcons(new Map(alternatives.flatMap(alternative => (alternative.icon ? [[alternative.name, alternative.icon] as const] : []))))
        })
        return () => {
            alive = false
        }
    }, [key])
    return icons
}

function ServicesReceipt({ entries, askedSlugs }: { entries: ServiceSetupEntry[]; askedSlugs: string[] }) {
    const t = useTranslations('chat.receipt')
    const { resolved, loading } = useCatalogServices(askedSlugs)
    const alternativeIcons = useAlternativeIcons(entries.some(entry => entry.replaces) ? askedSlugs : [])
    const iconByName = new Map([...resolved.values()].flatMap(service => (service.icon ? [[service.name, service.icon] as const] : [])))
    const connected = entries.filter(entry => entry.outcome === 'connected').length

    return (
        <ReceiptCard icon={LinkIcon} title={t('apps.title')} meta={t('apps.meta', { connected, total: entries.length })}>
            {entries.map(entry => {
                const status = SERVICE_STATUS[entry.outcome]
                const dimmed = entry.outcome !== 'connected'
                const icon = entry.replaces ? alternativeIcons.get(entry.name) : iconByName.get(entry.name)
                return (
                    <div key={entry.name} className="flex items-center gap-3 px-3 py-2.5">
                        {icon ? <Icon src={icon} size="sm" className={cn(dimmed && 'opacity-50 grayscale')} /> : loading ? <span className="size-8 shrink-0" /> : <Icon icon={LinkIcon} size="sm" className={cn(dimmed && 'opacity-50')} />}
                        <div className="min-w-0 flex-1">
                            <p className={cn('truncate text-sm', dimmed ? 'text-muted-foreground' : 'text-foreground')}>{entry.name}</p>
                            {entry.replaces && <p className="truncate text-xs text-muted-foreground">{t('apps.insteadOf', { name: entry.replaces })}</p>}
                        </div>
                        <Badge size="xs" tone={status.tone} glow={false}>
                            {t(`status.${status.labelKey}`)}
                        </Badge>
                    </div>
                )
            })}
        </ReceiptCard>
    )
}

type AnswersReceiptProps = {
    answers: QuestionAnswer[]
    input: Record<string, unknown> | null
    agentId?: string
    rawUrlFor?: RawUrlFor
    readFile?: ReadChatFile
}

function AnswersReceipt({ answers, input, agentId, rawUrlFor, readFile }: AnswersReceiptProps) {
    const t = useTranslations('chat.receipt')
    const offered = new Map(input ? pendingQuestions(input).map(item => [item.question, item.options.length > 0]) : [])
    const answered = answers.filter(item => item.answers.length > 0 || (item.attachments?.length ?? 0) > 0).length

    return (
        <ReceiptCard icon={MessageCircleQuestionIcon} title={answers.length === 1 ? t('answers.title.one') : t('answers.title.other')} meta={answers.length > 1 ? t('answers.meta', { answered, total: answers.length }) : undefined}>
            {answers.map(item => {
                const fromOptions = offered.get(item.question) ?? item.answers.length > 1
                const files = item.attachments ?? []
                return (
                    <div key={item.question} className="flex flex-col gap-1.5 px-3 py-2.5">
                        <p className="text-xs text-muted-foreground">{item.question}</p>
                        {item.answers.length === 0 && files.length === 0 && <p className="text-sm text-muted-foreground/70 italic">{t('status.skipped')}</p>}
                        {item.answers.length > 0 &&
                            (fromOptions ? (
                                <ul className="flex flex-col gap-1">
                                    {item.answers.map(value => (
                                        <li key={value} className="flex items-start gap-1.5 text-sm text-foreground">
                                            <CheckIcon className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
                                            {value}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm whitespace-pre-wrap text-foreground">{item.answers[0]}</p>
                            ))}
                        {files.length > 0 && <MessageAttachments agentId={agentId} paths={files} rawUrlFor={rawUrlFor} readFile={readFile} align="start" />}
                    </div>
                )
            })}
        </ReceiptCard>
    )
}

function SecretsReceipt({ entries, labels }: { entries: { key: string; provided: boolean }[]; labels: Map<string, string> }) {
    const t = useTranslations('chat.receipt')
    const stored = entries.filter(entry => entry.provided).length
    return (
        <ReceiptCard icon={KeyIcon} title={t('keys.title')} meta={t('keys.meta', { stored, total: entries.length })}>
            {entries.map(entry => {
                const label = labels.get(entry.key)
                return (
                    <div key={entry.key} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                            {label && label !== entry.key && <p className={cn('truncate text-sm', entry.provided ? 'text-foreground' : 'text-muted-foreground')}>{label}</p>}
                            <p className="truncate font-mono text-[11px] text-muted-foreground">{entry.key}</p>
                        </div>
                        <Badge size="xs" tone={entry.provided ? 'green' : 'neutral'} glow={false}>
                            {entry.provided ? t('status.stored') : t('status.skipped')}
                        </Badge>
                    </div>
                )
            })}
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{t('keys.note')}</p>
        </ReceiptCard>
    )
}

function ApprovalsReceipt({ decisions, details }: { decisions: Extract<HitlReply, { kind: 'approval' }>['decisions']; details: Map<string, string | undefined> }) {
    const t = useTranslations('chat.receipt')
    const approved = decisions.filter(item => item.decision === 'approved').length
    const declined = decisions.length - approved
    const meta = decisions.length === 1 ? undefined : approved && declined ? t('approvals.metaBoth', { approved, declined }) : approved ? t('approvals.metaApproved', { approved }) : t('approvals.metaDeclined', { declined })
    return (
        <ReceiptCard icon={ShieldCheckIcon} title={decisions.length === 1 ? t('approvals.title.one') : t('approvals.title.other')} meta={meta}>
            {decisions.map(item => {
                const detail = details.get(item.action)
                return (
                    <div key={item.action} className="flex items-start gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                            <p className={cn('text-sm', item.decision === 'approved' ? 'text-foreground' : 'text-muted-foreground line-through decoration-muted-foreground/40')}>{item.action}</p>
                            {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
                            {item.note && <p className="mt-1 text-xs whitespace-pre-wrap text-foreground/80">“{item.note}”</p>}
                        </div>
                        <Badge size="xs" tone={item.decision === 'approved' ? 'green' : 'red'} glow={false} className="mt-0.5">
                            {item.decision === 'approved' ? t('status.approved') : t('status.notNow')}
                        </Badge>
                    </div>
                )
            })}
        </ReceiptCard>
    )
}

function McpSignInReceipt({ agentId, name }: { agentId?: string; name: string }) {
    const t = useTranslations('chat.receipt')
    const server = useConnectorServices(agentId).custom.find(s => s.name === name)
    return (
        <ReceiptCard icon={PlugIcon} title={t('mcp.title')}>
            <div className="flex items-center gap-3 px-3 py-2.5">
                <Icon {...serviceIconProps(server?.icon ?? null, 'custom')} size="sm" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{server?.displayName ?? humanizeToolSegment(name)}</p>
                    {server?.host && <p className="truncate text-xs text-muted-foreground">{server.host}</p>}
                </div>
                <Badge size="xs" tone="green" glow={false}>
                    {t('status.connected')}
                </Badge>
            </div>
        </ReceiptCard>
    )
}

function TakeoverReceipt({ url }: { url: string | null }) {
    const t = useTranslations('chat.receipt')
    return (
        <p className="ml-auto flex max-w-[85%] items-center gap-1.5 text-xs text-muted-foreground">
            <MonitorIcon className="size-3 shrink-0" />
            <span className="truncate">{url ? t('takeover.handedBackOn', { url }) : t('takeover.handedBack')}</span>
        </p>
    )
}

function DismissedLine({ of }: { of: Extract<HitlReply, { kind: 'cancelled' }>['of'] }) {
    const t = useTranslations('chat.receipt.dismissed')
    return (
        <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <XIcon className="size-3" />
            {t(of)}
        </p>
    )
}
