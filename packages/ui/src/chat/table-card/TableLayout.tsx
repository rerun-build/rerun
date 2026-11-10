import type { TableCard } from '@rerun/contracts'

import { cn } from '../../cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../primitives'
import { formatCell, isNumericFormat, type CellContext } from './format-cell'
import { useKitTranslations } from '../../locale'

export function TableLayout({ card, context, mobileColumns }: { card: TableCard; context: CellContext; mobileColumns?: number }) {
    const t = useKitTranslations()
    const formats = card.formats ?? {}
    const hidden = (index: number) => mobileColumns !== undefined && index >= mobileColumns

    return (
        // The fade needs the overflow clipped: a mask over a scrolling box hides its own content.
        <div className="max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)] [&_[data-slot=table-container]]:overflow-x-hidden">
            <Table>
                <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                        {card.columns.map((column, i) => (
                            <TableHead key={column} className={cn('h-8 whitespace-nowrap text-[11px] text-muted-foreground', isNumericFormat(formats[column]) && 'text-right', hidden(i) && 'max-sm:hidden')}>
                                {column}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {card.rows.map((row, i) => (
                        <TableRow key={i} className="border-border hover:bg-transparent">
                            {card.columns.map((column, j) => (
                                <TableCell
                                    key={column}
                                    className={cn('max-w-48 truncate py-1.5 text-[12px]', isNumericFormat(formats[column]) && 'text-right', formats[column] === 'progress' && 'w-28', hidden(j) && 'max-sm:hidden')}
                                >
                                    {formats[column] ? formatCell(row[column], formats[column], context) : plainCell(row[column])}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                    {card.rows.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={Math.max(1, card.columns.length)} className="py-6 text-center text-[12px] text-muted-foreground">
                                {t('chat.table.empty')}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}

function plainCell(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}
