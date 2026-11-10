'use client'

import { FriendlyCell } from '@/components/data/FriendlyCell'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { absoluteDate, domainOf, isEmpty, relativeDate, rowCurrency, type FriendlyColumn } from '@/lib/data/friendly-columns'
import { ExternalLinkIcon, MailCheckIcon, ShieldCheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BadgeTone } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { EmailVerdictBadge } from './EmailVerdictBadge'
import { SourceFacepile, SourceLogo } from './SourceLogo'
import type { CellSource, RowSources } from './table-sources'

export type LeadField = { key: string; label: string; value: ReactNode; source?: CellSource }

export function FieldSourceDetails({ cell }: { cell: CellSource }) {
    const locale = useLocale()
    const t = useTranslations('data.sources')
    return (
        <div className="flex flex-col gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
                <SourceLogo source={cell.source} />
                <span className="min-w-0 flex-1 truncate text-foreground">{cell.source.name}</span>
                <span title={absoluteDate(cell.at, locale)} className="shrink-0 text-muted-foreground tabular-nums">
                    {relativeDate(cell.at, locale)}
                </span>
            </div>
            {cell.verdict && (
                <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                        <MailCheckIcon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 text-muted-foreground">{t(`verdicts.${cell.verdict}.detail`)}</span>
                    <EmailVerdictBadge status={cell.verdict} />
                </div>
            )}
            {cell.href && (
                <a href={cell.href} target="_blank" rel="noreferrer" className="flex min-h-6 items-center gap-1 text-muted-foreground hover:text-foreground">
                    <ExternalLinkIcon className="size-3" />
                    {t('openSource')}
                </a>
            )}
        </div>
    )
}

const FIELD_ROW = 'flex min-h-11 w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0'

function FieldRowContent({ field }: { field: LeadField }) {
    const t = useTranslations('data.sources')
    return (
        <>
            <span className="w-20 shrink-0 truncate text-xs text-muted-foreground sm:w-24">{field.label}</span>
            <span className="min-w-0 flex-1 text-sm break-words text-foreground">{field.value}</span>
            {field.source?.verdict === 'verified' && <ShieldCheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('verified')} />}
            {field.source && <SourceLogo source={field.source.source} size="xs" />}
        </>
    )
}

/** Every field of a row, each traced one with the logo of where it came from; a tap tells the rest. */
export function LeadFieldList({ fields, className }: { fields: readonly LeadField[]; className?: string }) {
    return (
        <div className={cn('flex flex-col rounded-xl border border-border bg-background', className)}>
            {fields.map(field =>
                field.source ? (
                    <Popover key={field.key}>
                        <PopoverTrigger asChild>
                            <button type="button" className={cn(FIELD_ROW, 'transition-colors hover:bg-muted/50 data-[state=open]:bg-muted/50')}>
                                <FieldRowContent field={field} />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-[min(280px,calc(100vw-2rem))] p-3">
                            <FieldSourceDetails cell={field.source} />
                        </PopoverContent>
                    </Popover>
                ) : (
                    <div key={field.key} className={FIELD_ROW}>
                        <FieldRowContent field={field} />
                    </div>
                )
            )}
        </div>
    )
}

type Row = Record<string, unknown>

export function leadFields(row: Row, columns: readonly FriendlyColumn[], sources: RowSources | null, tones?: Record<string, BadgeTone>): LeadField[] {
    const currency = rowCurrency(row)
    return columns
        .filter(column => column.kind === 'boolean' || !isEmpty(row[column.key]))
        .map(column => {
            const value = row[column.key]
            const source = sources?.cells[column.key]
            // A traced field is a button, and a link cannot sit inside one.
            const shown = column.kind === 'url' && source ? <span className="break-all">{domainOf(String(value))}</span> : <FriendlyCell value={value} column={column} currency={currency} tones={tones} maxTags={6} wrap />
            return { key: column.key, label: column.label, value: shown, source }
        })
}

function rowTitle(row: Row, columns: readonly FriendlyColumn[], fallback: string): string {
    const title = columns.find(column => column.kind === 'title' && !isEmpty(row[column.key])) ?? columns.find(column => !isEmpty(row[column.key]) && typeof row[column.key] === 'string')
    return title ? String(row[title.key]) : fallback
}

type LeadSourcesSheetProps = {
    row: Row | null
    onOpenChange: (open: boolean) => void
    /** The columns to list, in order. */
    columns: readonly FriendlyColumn[]
    sources: RowSources | null
    tones?: Record<string, BadgeTone>
}

export function LeadSourcesSheet({ row, onOpenChange, columns, sources, tones }: LeadSourcesSheetProps) {
    const t = useTranslations('data.sources')
    return (
        <Sheet open={row !== null} onOpenChange={onOpenChange}>
            <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
                {row && (
                    <>
                        <SheetHeader className="shrink-0 pr-12">
                            <SheetTitle className="truncate">{rowTitle(row, columns, t('row'))}</SheetTitle>
                            <SheetDescription asChild>
                                <div className="flex min-h-5 items-center">{sources && <SourceFacepile sources={sources.sources} size="sm" max={6} />}</div>
                            </SheetDescription>
                        </SheetHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                            <LeadFieldList fields={leadFields(row, columns, sources, tones)} />
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    )
}
