import { cellText, formatText, isNumericFormat, isTruthyCell, type TableCard } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { useState } from 'react'
import { View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { mediaUrl } from '@/api/files'
import { HorizontalScroll } from '@/components/chat/HorizontalScroll'
import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { AuthedImage, CardFrame } from './CardParts'
import { toneOf } from './cards'

const COLUMN_WIDTH = 132

const titleOf = (table: string) => table.replace(/[_-]+/g, ' ').replace(/^\w/, letter => letter.toUpperCase())

function Cell({ value, format, tones, agentId }: { value: unknown; format?: string; tones?: Record<string, string>; agentId: string }) {
    const theme = useTheme()
    if (value === null || value === undefined || value === '') {
        return (
            <AppText variant="footnote" tone="muted">
                —
            </AppText>
        )
    }
    if (format === 'boolean') return <Icon name={isTruthyCell(value) ? 'check' : 'minus'} size={12} bold color={isTruthyCell(value) ? theme.foreground : theme.mutedForeground} />
    if (format === 'tag') return <Badge size="xs" label={cellText(value)} tone={toneOf(cellText(value), tones)} />
    if (format === 'image') return <AuthedImage url={mediaUrl(value, agentId)} style={{ width: 24, height: 24, borderRadius: 4 }} />
    if (format === 'rating') return <AppText variant="footnote">{'★'.repeat(Math.max(0, Math.min(5, Math.round(Number(value)))))}</AppText>
    if (format === 'progress') {
        const number = Number(value)
        return <AppText variant="footnote" style={{ fontVariant: ['tabular-nums'] }}>{`${Math.round(number <= 1 ? number * 100 : number)}%`}</AppText>
    }
    return (
        <AppText variant="footnote" numberOfLines={2} style={isNumericFormat(format) ? { fontVariant: ['tabular-nums'] } : undefined}>
            {formatText(value, format)}
        </AppText>
    )
}

function ListRows({ card, agentId }: { card: TableCard; agentId: string }) {
    const theme = useTheme()
    const fields = card.fields ?? {}
    const formats = card.formats ?? {}
    return (
        <View>
            {card.rows.map((row, index) => {
                const title = cellText(fields.title ? row[fields.title] : '')
                return (
                    <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.border }}>
                        {fields.image && <AuthedImage url={mediaUrl(row[fields.image], agentId)} fallback="user" style={{ width: 32, height: 32, borderRadius: 16 }} />}
                        <View style={{ flex: 1, gap: 2 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                                <AppText variant="callout" medium numberOfLines={1} style={{ flexShrink: 1 }}>
                                    {title}
                                </AppText>
                                {fields.badge && row[fields.badge] != null && <Badge size="xs" label={cellText(row[fields.badge])} tone={toneOf(cellText(row[fields.badge]), card.tones)} />}
                            </View>
                            {fields.subtitle && (
                                <AppText variant="footnote" tone="muted" numberOfLines={1}>
                                    {formatText(row[fields.subtitle], formats[fields.subtitle])}
                                </AppText>
                            )}
                        </View>
                        {(fields.value || fields.date) && (
                            <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                {fields.value && <Cell value={row[fields.value]} format={formats[fields.value]} tones={card.tones} agentId={agentId} />}
                                {fields.date && (
                                    <AppText variant="caption" tone="muted">
                                        {formatText(row[fields.date], formats[fields.date] ?? 'date')}
                                    </AppText>
                                )}
                            </View>
                        )}
                    </View>
                )
            })}
        </View>
    )
}

// Every row takes the same column widths: the card's width shared out, never narrower than a column
// can be read at, past which the grid scrolls sideways.
function Grid({ card, agentId }: { card: TableCard; agentId: string }) {
    const theme = useTheme()
    const formats = card.formats ?? {}
    const [cardWidth, setCardWidth] = useState(0)
    const width = Math.max(COLUMN_WIDTH, card.columns.length ? cardWidth / card.columns.length : 0)
    return (
        <HorizontalScroll nestedScrollEnabled onLayout={event => setCardWidth(event.nativeEvent.layout.width)}>
            <View style={{ flexDirection: 'row', backgroundColor: theme.muted }}>
                {card.columns.map(column => (
                    <View key={column} style={{ width, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <AppText variant="caption" tone="muted" medium numberOfLines={1}>
                            {column}
                        </AppText>
                    </View>
                ))}
            </View>
            {card.rows.map((row, index) => (
                <View key={index} style={{ flexDirection: 'row', borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.border }}>
                    {card.columns.map(column => (
                        <View key={column} style={{ width, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' }}>
                            <Cell value={row[column]} format={formats[column]} tones={card.tones} agentId={agentId} />
                        </View>
                    ))}
                </View>
            ))}
        </HorizontalScroll>
    )
}

// Rows a coworker filled, frozen in the message as it sent them. A layout with named fields reads as a
// list; a plain table keeps its columns and scrolls sideways.
export function TableCardView({ card, agentId }: { card: TableCard; agentId: string }) {
    const t = useTranslations('mobileCards.table')
    const locale = useLocale()
    const asList = card.layout !== undefined && card.layout !== 'table' && Boolean(card.fields?.title)
    const meta = card.rows.length < card.total ? t('partial', { shown: card.rows.length, total: card.total }) : formatNumber(card.total, locale)
    return (
        <CardFrame symbol="table" title={titleOf(card.table)} meta={meta}>
            {asList ? <ListRows card={card} agentId={agentId} /> : <Grid card={card} agentId={agentId} />}
        </CardFrame>
    )
}
