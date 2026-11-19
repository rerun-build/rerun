import type { TableCard } from '@moldwright/contracts'

import type { CellContext } from './format-cell'
import { ListItem } from './items'
import { EmptyRows } from './TableCardFrame'

export function ListLayout({ card, context }: { card: TableCard; context: CellContext }) {
    const { fields = {}, formats = {} } = card
    if (card.rows.length === 0) return <EmptyRows />

    return (
        <ul className="divide-y divide-border">
            {card.rows.map((row, i) => (
                <li key={i}>
                    <ListItem row={row} fields={fields} formats={formats} context={context} />
                </li>
            ))}
        </ul>
    )
}
