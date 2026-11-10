'use client'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Icon } from '@/components/ui/icon'
import { CheckIcon, ChevronRightIcon, CopyIcon, WebhookIcon } from '@/lib/icons'
import { type TriggerPayload } from '@/lib/triggers/trigger-payload'
import { formatBytes } from '@/lib/files/format'
import { cn } from '@/lib/utils'
import { formatDate } from '@rerun/i18n/format'
import { Badge, type BadgeTone } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useState } from 'react'

const METHOD_TONES: Record<string, BadgeTone> = {
    GET: 'cyan',
    POST: 'green',
    PUT: 'orange',
    PATCH: 'orange',
    DELETE: 'red',
}

const PREVIEW_LINES = 24

export function TriggerPayloadBlock({ payload }: { payload: TriggerPayload }) {
    const hasBody = payload.body.length > 0
    const [open, setOpen] = useState(hasBody && payload.body.split('\n').length <= PREVIEW_LINES)

    return (
        <Collapsible open={open && hasBody} onOpenChange={setOpen} className="w-full rounded-xl bg-background/40 transition-colors data-[state=open]:bg-background/70">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors data-[state=closed]:hover:bg-background/70">
                <Icon icon={WebhookIcon} size="sm" />
                <span className="min-w-0 flex-1 truncate font-medium">{payload.slug}</span>
                <TriggerPayloadSummary payload={payload} />
                {hasBody && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />}
            </CollapsibleTrigger>

            {hasBody && (
                <CollapsibleContent>
                    <div className="mx-2 border-t border-border/60 pt-2 pb-3">
                        <TriggerPayloadDetails payload={payload} />
                    </div>
                </CollapsibleContent>
            )}
        </Collapsible>
    )
}

export function TriggerPayloadSummary({ payload }: { payload: TriggerPayload }) {
    const t = useTranslations('chat.triggerPayload')
    const locale = useLocale()
    return (
        <>
            <Badge tone={METHOD_TONES[payload.method] ?? 'neutral'} size="xs" glow={false} className="shrink-0 font-mono uppercase">
                {payload.method}
            </Badge>
            {payload.truncated && (
                <Badge tone="orange" size="xs" glow={false} className="shrink-0">
                    {t('truncated')}
                </Badge>
            )}
            {payload.body.length > 0 ? (
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatBytes(payload.bytes, locale)}</span>
            ) : (
                <span className="shrink-0 text-xs text-muted-foreground">{t('empty')}</span>
            )}
        </>
    )
}

export function TriggerPayloadDetails({ payload, bodyClassName }: { payload: TriggerPayload; bodyClassName?: string }) {
    const t = useTranslations('chat.triggerPayload')
    const locale = useLocale()
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                {payload.receivedAt && <span className="tabular-nums">{formatReceivedAt(payload.receivedAt, locale)}</span>}
                {payload.contentType && <span>{payload.contentType}</span>}
                {payload.query && <span className="break-all">?{payload.query}</span>}
            </div>
            {payload.body.length > 0 && (
                <div>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('payload')}</span>
                        <CopyPayloadButton text={payload.body} />
                    </div>
                    <pre className={cn('mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground', bodyClassName)}>
                        {payload.isJson ? highlightJson(payload.body) : payload.body}
                    </pre>
                </div>
            )}
        </div>
    )
}

function formatReceivedAt(iso: string, locale: string): string {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : formatDate(date, locale)
}

function CopyPayloadButton({ text }: { text: string }) {
    const t = useTranslations('chat.actions')
    const [copied, setCopied] = useState(false)
    return (
        <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
                navigator.clipboard.writeText(text).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                })
            }}
        >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            {copied ? t('copied') : t('copy')}
        </button>
    )
}

const JSON_TOKEN = /"(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

function highlightJson(json: string): ReactNode[] {
    const nodes: ReactNode[] = []
    let cursor = 0

    for (const match of json.matchAll(JSON_TOKEN)) {
        const start = match.index
        if (start > cursor) nodes.push(json.slice(cursor, start))
        const token = match[0]

        if (match[1]) {
            const key = token.slice(0, token.length - match[1].length)
            nodes.push(
                <span key={start} className="text-sky-600 dark:text-sky-300">
                    {key}
                </span>,
            )
            nodes.push(match[1])
        } else {
            nodes.push(
                <span key={start} className={tokenClass(token)}>
                    {token}
                </span>,
            )
        }
        cursor = start + token.length
    }

    if (cursor < json.length) nodes.push(json.slice(cursor))
    return nodes
}

function tokenClass(token: string): string {
    if (token.startsWith('"')) return 'text-emerald-600 dark:text-emerald-400'
    if (token === 'true' || token === 'false' || token === 'null') return 'text-violet-600 dark:text-violet-400'
    return 'text-amber-600 dark:text-amber-400'
}
