'use client'

import type { TableCard as TableCardData } from '@rerun/contracts'

import { BoardLayout } from './BoardLayout'
import type { FileUrl } from './CardMedia'
import type { CellContext } from './format-cell'
import { GalleryLayout } from './GalleryLayout'
import { ListLayout } from './ListLayout'
import { TableCardFrame } from './TableCardFrame'
import { TableLayout } from './TableLayout'
import { useKitTranslations } from '../../locale'

export type TableCardProps = {
    card: TableCardData
    /** Where the reader goes to browse the live table. */
    onOpen?: () => void
    /** Why that button is off, as a tooltip. Ignored when `onOpen` is set; with neither, there is
        no database to open at all and no button is drawn. */
    openDisabledReason?: string
    /** What the rows are, for the footer count. */
    noun?: string
    /** Columns from this index on are hidden below `sm`. Table layout only. */
    mobileColumns?: number
    /** Resolves an image cell holding a file path rather than a URL. Without it, only http(s) images load. */
    fileUrl?: FileUrl
    className?: string
}

/**
 * A frozen preview of one database table, sent by the agent in the layout it picked. The rows are
 * the snapshot carried in the tool output, never a fresh read: they are what the agent saw when it
 * sent the card.
 */
export function TableCard({ card, onOpen, openDisabledReason, noun, mobileColumns, fileUrl, className }: TableCardProps) {
    const t = useKitTranslations()
    const context: CellContext = { tones: card.tones, fileUrl }

    return (
        <TableCardFrame
            card={card}
            onOpen={onOpen}
            openDisabledReason={openDisabledReason}
            noun={noun}
            footerNote={card.layout === 'board' && card.groupBy ? t('chat.table.groupedBy', { column: card.groupBy }) : undefined}
            className={className}
        >
            {card.layout === 'list' ? (
                <ListLayout card={card} context={context} />
            ) : card.layout === 'gallery' ? (
                <GalleryLayout card={card} context={context} />
            ) : card.layout === 'board' ? (
                <BoardLayout card={card} context={context} />
            ) : (
                <TableLayout card={card} context={context} mobileColumns={mobileColumns} />
            )}
        </TableCardFrame>
    )
}
