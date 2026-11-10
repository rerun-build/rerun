import { cellText, formatText, isNumericFormat, isTruthyCell } from '@rerun/contracts'
import type { ReactNode } from 'react'

import { cn } from '../../cn'
import { CheckIcon, MinusIcon } from '../../icons'
import { Badge, type BadgeTone } from '../../primitives'
import { CardThumb, type FileUrl } from './CardMedia'
import { useKitTranslations } from '../../locale'

export { cellText, formatText, isNumericFormat }

export type CellContext = { tones?: Record<string, BadgeTone>; fileUrl?: FileUrl }

const HASHED_TONES: BadgeTone[] = ['brand', 'cyan', 'green', 'orange', 'yellow', 'neutral']

/** The tone the agent gave a value, or a stable one hashed from the value so it never flickers. */
export function toneOf(value: string, tones?: Record<string, BadgeTone>): BadgeTone {
    const explicit = tones?.[value]
    if (explicit) return explicit
    let hash = 0
    for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return HASHED_TONES[Math.abs(hash) % HASHED_TONES.length]
}

export function formatCell(value: unknown, format: string | undefined, context: CellContext): ReactNode {
    if (value === null || value === undefined || value === '') return <span className="text-muted-foreground/50">—</span>
    switch (format) {
        case 'rating':
            return <Rating value={Number(value)} />
        case 'progress':
            return <Progress value={Number(value)} />
        case 'boolean':
            return isTruthyCell(value) ? <CheckIcon className="size-3.5 text-green-500" /> : <MinusIcon className="size-3.5 text-muted-foreground/50" />
        case 'tag':
            return (
                <Badge size="xs" tone={toneOf(cellText(value), context.tones)} glow={false}>
                    {cellText(value)}
                </Badge>
            )
        case 'url':
        case 'email':
            return <span className="text-foreground underline decoration-foreground/20 underline-offset-2">{formatText(value, format)}</span>
        case 'image':
            return <CardThumb src={value} fileUrl={context.fileUrl} className="size-6 rounded" />
        default:
            return <span className={cn(isNumericFormat(format) && 'tabular-nums')}>{formatText(value, format)}</span>
    }
}

export function Rating({ value, className }: { value: number; className?: string }) {
    const t = useKitTranslations()
    return (
        <span className={cn('inline-flex items-center gap-px', className)} aria-label={t('chat.table.rating', { value })}>
            {[1, 2, 3, 4, 5].map(step => (
                <svg key={step} viewBox="0 0 24 24" aria-hidden className={cn('size-3 fill-current', step <= Math.round(value) ? 'text-yellow-500' : 'text-muted-foreground/25')}>
                    <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
                </svg>
            ))}
        </span>
    )
}

/** Takes a 0-1 ratio or a 0-100 percentage. */
export function Progress({ value, className }: { value: number; className?: string }) {
    const percent = Math.max(0, Math.min(100, value <= 1 ? value * 100 : value))
    return (
        <span className={cn('inline-flex w-full min-w-16 items-center gap-2', className)}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
            </span>
            <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
        </span>
    )
}
