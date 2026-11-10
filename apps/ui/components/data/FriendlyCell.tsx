'use client'

import { useLocale, useTranslations } from 'next-intl'

import { absoluteDate, capitalize, domainOf, externalHref, isEmpty, parseJson, plainValue, relativeDate, truthy, type ColumnKind, type FriendlyColumn } from '@/lib/data/friendly-columns'
import {
    AlignLeftIcon,
    CalendarIcon,
    CheckIcon,
    CircleDollarSignIcon,
    CircleIcon,
    CodeIcon,
    HashIcon,
    LinkIcon,
    MailIcon,
    StarIcon,
    TagIcon,
    TypeIcon,
    UserRoundIcon,
    type LucideIcon,
} from '@/lib/icons'
import { cn } from '@/lib/utils'
import { toneOf } from '@rerun/ui/chat'
import { Badge, type BadgeTone } from '@rerun/ui/primitives'

export const KIND_ICONS: Record<ColumnKind, LucideIcon> = {
    title: TypeIcon,
    code: HashIcon,
    text: AlignLeftIcon,
    longtext: AlignLeftIcon,
    number: HashIcon,
    currency: CircleDollarSignIcon,
    cents: CircleDollarSignIcon,
    percent: HashIcon,
    rating: StarIcon,
    date: CalendarIcon,
    status: CircleIcon,
    tags: TagIcon,
    email: MailIcon,
    url: LinkIcon,
    boolean: CheckIcon,
    person: UserRoundIcon,
    json: CodeIcon,
}

const STATUS_TONES: Record<string, BadgeTone> = {
    new: 'brand',
    pending: 'yellow',
    contacted: 'cyan',
    replied: 'orange',
    qualified: 'green',
    synced: 'green',
    done: 'green',
    won: 'green',
    lost: 'red',
    failed: 'red',
    error: 'red',
    skipped: 'neutral',
    high: 'red',
    medium: 'orange',
    low: 'neutral',
}

function statusTone(value: string, tones?: Record<string, BadgeTone>): BadgeTone {
    return tones?.[value] ?? STATUS_TONES[value.toLowerCase()] ?? toneOf(value)
}

const AVATAR_COLORS = [
    'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
]

export function LetterAvatar({ name, shape = 'circle', className }: { name: string; shape?: 'circle' | 'square'; className?: string }) {
    let hash = 0
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
    const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase()
    return (
        <span
            aria-hidden
            className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center text-[9px] font-semibold',
                shape === 'circle' ? 'rounded-full' : 'rounded-[5px]',
                AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length],
                className,
            )}
        >
            {initials || '?'}
        </span>
    )
}

function TagList({ tags, max }: { tags: string[]; max: number }) {
    const shown = tags.slice(0, max)
    const hidden = tags.length - shown.length
    return (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
            {shown.map(tag => (
                <Badge key={tag} size="xs" tone="neutral" glow={false}>
                    {tag}
                </Badge>
            ))}
            {hidden > 0 && <span className="text-[11px] text-muted-foreground">+{hidden}</span>}
        </span>
    )
}

function ScoreBar({ value }: { value: number }) {
    const clamped = Math.max(0, Math.min(100, value))
    return (
        <span className="flex items-center justify-end gap-2">
            <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted @md:block">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
            </span>
            <span className="tabular-nums">{value}</span>
        </span>
    )
}

// Table cells ignore max-width, so the cap lives on the content itself.
const TEXT_CELL = 'block max-w-60 truncate'

type FriendlyCellProps = {
    value: unknown
    column: FriendlyColumn
    /** The ISO code the row gives its amounts, when it has one. */
    currency?: string
    /** Tones an agent gave to values in the active view. */
    tones?: Record<string, BadgeTone>
    /** How many tags fit before the rest folds into +N. */
    maxTags?: number
    /** In the row sheet, text runs over several lines instead of being cut. */
    wrap?: boolean
    className?: string
}

/** One value, written the way a person would write it: no NULL, no ISO date, no raw JSON. */
export function FriendlyCell({ value, column, currency, tones, maxTags = 2, wrap = false, className }: FriendlyCellProps) {
    const locale = useLocale()
    const t = useTranslations('data.cell')
    if (column.kind === 'boolean') {
        const checked = truthy(value)
        return (
            <span
                role="img"
                aria-label={checked ? t('yes') : t('no')}
                className={cn('inline-flex size-4 items-center justify-center rounded border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border', className)}
            >
                {checked && <CheckIcon className="size-3" />}
            </span>
        )
    }
    if (isEmpty(value)) return null
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    const textCell = wrap ? 'break-words' : TEXT_CELL

    switch (column.kind) {
        case 'title':
            return <span className={cn(textCell, 'font-medium text-foreground', className)}>{text}</span>
        case 'code':
            return <span className={cn(wrap ? 'break-all' : TEXT_CELL, 'font-mono text-[12px] text-muted-foreground', className)}>{text}</span>
        case 'status':
            return (
                <Badge size="xs" tone={statusTone(text, tones)} glow={false}>
                    {capitalize(text)}
                </Badge>
            )
        case 'tags': {
            const parsed = parseJson(value)
            return <TagList tags={Array.isArray(parsed) ? parsed.map(String) : [text]} max={maxTags} />
        }
        case 'date':
            return (
                <span title={absoluteDate(text, locale)} className={cn('whitespace-nowrap text-muted-foreground', className)}>
                    {relativeDate(text, locale)}
                </span>
            )
        case 'url': {
            const href = externalHref(text)
            if (!href) return <span className={cn(textCell, className)}>{text}</span>
            return (
                <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={event => event.stopPropagation()}
                    className={cn(textCell, 'text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground', className)}
                >
                    {domainOf(text)}
                </a>
            )
        }
        case 'email':
            return <span className={cn(wrap ? 'break-all' : TEXT_CELL, 'text-muted-foreground', className)}>{text}</span>
        case 'person':
            return (
                <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
                    <LetterAvatar name={text} />
                    <span className="truncate">{text}</span>
                </span>
            )
        case 'rating':
            return (
                <span className={cn('inline-flex items-center gap-1 tabular-nums', className)}>
                    <StarIcon className="size-3 fill-amber-400 text-amber-400" />
                    {Number.isNaN(Number(value)) ? text : Number(value).toFixed(1)}
                </span>
            )
        case 'number':
            return column.key.toLowerCase().includes('score') && !Number.isNaN(Number(value)) ? (
                <ScoreBar value={Number(value)} />
            ) : (
                <span className={cn('tabular-nums', className)}>{plainValue(value, 'number', undefined, locale)}</span>
            )
        case 'currency':
        case 'cents':
        case 'percent':
            if (Number.isNaN(Number(value))) return <span className={cn(textCell, className)}>{text}</span>
            return <span className={cn('tabular-nums', className)}>{plainValue(value, column.kind, currency, locale)}</span>
        case 'json':
            return (
                <Badge size="xs" tone="neutral" glow={false}>
                    {plainValue(value, 'json', undefined, locale)}
                </Badge>
            )
        case 'longtext':
            return <span className={cn(wrap ? 'break-words whitespace-pre-wrap' : 'line-clamp-1 max-w-80', 'text-muted-foreground', className)}>{text}</span>
        default:
            return <span className={cn(textCell, className)}>{text}</span>
    }
}
