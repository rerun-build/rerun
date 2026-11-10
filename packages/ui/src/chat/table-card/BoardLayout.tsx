import type { TableCard } from '@rerun/contracts'

import { cellText, type CellContext } from './format-cell'
import { BoardColumnHeader, BoardItem } from './items'
import { EmptyRows } from './TableCardFrame'
import { useKitTranslations } from '../../locale'

/**
 * A kanban over `groupBy`. The counts and sums on each column come from `groups`, counted over the
 * whole table: the cards under them are only the first few rows of each group.
 */
export function BoardLayout({ card, context }: { card: TableCard; context: CellContext }) {
    const t = useKitTranslations()
    const { fields = {}, formats = {}, groupBy, groups = [] } = card
    const valueFormat = fields.value ? formats[fields.value] : undefined
    if (groups.length === 0) return <EmptyRows />

    return (
        <div className="flex gap-2 overflow-x-auto p-2.5 [scrollbar-width:none]">
            {groups.map(group => {
                const rows = card.rows.filter(row => cellText(groupBy ? row[groupBy] : '') === group.value)
                const hidden = group.total - rows.length
                return (
                    <div key={group.value} className="flex w-44 shrink-0 flex-col gap-1.5 rounded-md bg-background/50 p-1.5">
                        <BoardColumnHeader value={group.value} total={group.total} sum={group.sum} valueFormat={valueFormat} context={context} />
                        {rows.map((row, i) => (
                            <BoardItem key={i} row={row} fields={fields} formats={formats} context={context} />
                        ))}
                        {hidden > 0 && <span className="px-1 pb-0.5 text-[11px] text-muted-foreground">{t('chat.table.more', { count: hidden })}</span>}
                    </div>
                )
            })}
        </div>
    )
}
