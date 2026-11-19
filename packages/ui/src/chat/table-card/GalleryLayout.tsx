import type { TableCard } from '@moldwright/contracts'

import { cn } from '../../cn'
import type { CellContext } from './format-cell'
import { GalleryItem } from './items'
import { EmptyRows } from './TableCardFrame'

export function GalleryLayout({ card, context }: { card: TableCard; context: CellContext }) {
    const { fields = {}, formats = {} } = card
    const shape = card.display?.shape ?? 'square'
    const carousel = card.display?.arrangement === 'carousel'
    if (card.rows.length === 0) return <EmptyRows />

    return (
        <div className={cn('p-2.5', carousel ? 'flex snap-x gap-2.5 overflow-x-auto [scrollbar-width:none]' : cn('grid gap-2.5', shape === 'landscape' ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'))}>
            {card.rows.map((row, i) => (
                <GalleryItem key={i} row={row} fields={fields} formats={formats} context={context} shape={shape} className={cn(carousel && 'w-40 shrink-0 snap-start')} />
            ))}
        </div>
    )
}
