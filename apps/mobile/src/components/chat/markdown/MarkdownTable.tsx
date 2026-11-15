import type { Tokens } from 'marked'
import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { HorizontalScroll } from '@/components/chat/HorizontalScroll'
import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { fonts, spacing } from '@/theme/tokens'

const CHAR_WIDTH = 7.5
const MIN_COLUMN = 72
const MAX_COLUMN = 240

function columnWidths(token: Tokens.Table, available: number): number[] {
    const wanted = token.header.map((cell, column) => {
        const longest = Math.max(cell.text.length, ...token.rows.map(row => row[column]?.text.length ?? 0))
        return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, Math.ceil(longest * CHAR_WIDTH) + spacing.md * 2))
    })
    const total = wanted.reduce((sum, width) => sum + width, 0)
    return total < available ? wanted.map(width => (width * available) / total) : wanted
}

const ALIGN = { left: 'left', center: 'center', right: 'right' } as const

export function MarkdownTable({ token, renderCell }: { token: Tokens.Table; renderCell: (cell: Tokens.TableCell) => ReactNode }) {
    const theme = useTheme()
    const [available, setAvailable] = useState(0)
    const widths = columnWidths(token, available)
    const row = (cells: Tokens.TableCell[], header: boolean, last: boolean) =>
        cells.map((cell, column) => (
            <View key={column} style={{ width: widths[column], paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: header ? 2 : last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: theme.border }}>
                <AppText variant="footnote" selectable style={{ fontSize: 14, lineHeight: 20, fontFamily: header ? fonts.semibold : fonts.regular, textAlign: ALIGN[token.align[column] ?? 'left'] ?? 'left' }}>
                    {renderCell(cell)}
                </AppText>
            </View>
        ))
    return (
        <View style={{ alignSelf: 'stretch', borderRadius: 20, borderCurve: 'continuous', backgroundColor: theme.muted, padding: 6 }}>
            <View onLayout={event => setAvailable(event.nativeEvent.layout.width)} style={{ borderRadius: 14, borderCurve: 'continuous', backgroundColor: theme.background, overflow: 'hidden' }}>
                <HorizontalScroll>
                    <View style={{ flexDirection: 'row' }}>{row(token.header, true, false)}</View>
                    {token.rows.map((cells, i) => (
                        <View key={i} style={{ flexDirection: 'row' }}>
                            {row(cells, false, i === token.rows.length - 1)}
                        </View>
                    ))}
                </HorizontalScroll>
            </View>
        </View>
    )
}
