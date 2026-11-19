import type { CardFields } from '@moldwright/contracts'

import { cn } from '../../cn'
import { Badge } from '../../primitives'
import { CardAvatar, CardThumb } from './CardMedia'
import { cellText, formatCell, formatText, toneOf, type CellContext } from './format-cell'

export type RowItemProps = {
    row: Record<string, unknown>
    fields: CardFields
    formats: Record<string, string>
    context: CellContext
    className?: string
}

export const GALLERY_ASPECT = { square: 'aspect-square', landscape: 'aspect-[4/3]', portrait: 'aspect-[3/4]' } as const
export type GalleryShape = keyof typeof GALLERY_ASPECT

export function ListItem({ row, fields, formats, context, className }: RowItemProps) {
    const title = cellText(fields.title ? row[fields.title] : '')
    return (
        <div className={cn('flex items-center gap-3 px-3 py-2.5', className)}>
            <CardAvatar src={fields.image ? row[fields.image] : undefined} fileUrl={context.fileUrl} name={title} className="size-8" />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{title}</span>
                    {fields.badge && row[fields.badge] != null && formatCell(row[fields.badge], 'tag', context)}
                </div>
                {fields.subtitle && <p className="truncate text-[12px] text-muted-foreground">{formatText(row[fields.subtitle], formats[fields.subtitle])}</p>}
            </div>
            {(fields.value || fields.date) && (
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {fields.value && <span className="text-[13px] tabular-nums">{formatCell(row[fields.value], formats[fields.value], context)}</span>}
                    {fields.date && <span className="text-[11px] tabular-nums text-muted-foreground">{formatText(row[fields.date], formats[fields.date] ?? 'date')}</span>}
                </div>
            )}
        </div>
    )
}

export function GalleryItem({ row, fields, formats, context, shape = 'square', className }: RowItemProps & { shape?: GalleryShape }) {
    return (
        <div className={cn('flex flex-col overflow-hidden rounded-md border border-border bg-background', className)}>
            <div className="relative">
                <CardThumb src={fields.image ? row[fields.image] : undefined} fileUrl={context.fileUrl} className={cn('w-full', GALLERY_ASPECT[shape])} />
                {fields.badge && row[fields.badge] != null && (
                    <Badge size="xs" fill="media" tone={toneOf(cellText(row[fields.badge]), context.tones)} glow={false} className="absolute top-1.5 left-1.5">
                        {cellText(row[fields.badge])}
                    </Badge>
                )}
            </div>
            <div className="flex flex-1 flex-col gap-0.5 px-2 py-1.5">
                <span className="line-clamp-1 text-[12px] font-medium">{cellText(fields.title ? row[fields.title] : '')}</span>
                {fields.subtitle && <span className="line-clamp-1 text-[11px] text-muted-foreground">{formatText(row[fields.subtitle], formats[fields.subtitle])}</span>}
                {fields.value && <span className="mt-auto pt-0.5 text-[12px] font-medium">{formatCell(row[fields.value], formats[fields.value], context)}</span>}
            </div>
        </div>
    )
}

export function BoardItem({ row, fields, formats, context, className }: RowItemProps) {
    const title = cellText(fields.title ? row[fields.title] : '')
    return (
        <div className={cn('flex flex-col gap-1 rounded-md border border-border bg-card px-2 py-1.5', className)}>
            <div className="flex items-center gap-1.5">
                {fields.image && <CardAvatar src={row[fields.image]} fileUrl={context.fileUrl} name={title} className="size-5 text-[9px]" />}
                <span className="truncate text-[12px] font-medium">{title}</span>
            </div>
            {fields.subtitle && <span className="truncate text-[11px] text-muted-foreground">{formatText(row[fields.subtitle], formats[fields.subtitle])}</span>}
            {fields.value && <span className="text-[11px]">{formatCell(row[fields.value], formats[fields.value], context)}</span>}
        </div>
    )
}

export type BoardColumnHeaderProps = {
    value: string
    total: number
    sum?: number
    valueFormat?: string
    context: CellContext
    className?: string
}

export function BoardColumnHeader({ value, total, sum, valueFormat, context, className }: BoardColumnHeaderProps) {
    return (
        <div className={cn('flex items-center gap-1.5 px-1 pt-0.5', className)}>
            <Badge size="xs" tone={toneOf(value, context.tones)} glow={false}>
                {value || '—'}
            </Badge>
            <span className="text-[11px] tabular-nums text-muted-foreground">{total}</span>
            {sum !== undefined && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{formatText(sum, valueFormat)}</span>}
        </div>
    )
}
