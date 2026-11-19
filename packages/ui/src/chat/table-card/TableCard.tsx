'use client'

import type { TableCard as TableCardData } from '@moldwright/contracts'

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
    onOpen?: () => void
    openDisabledReason?: string
    noun?: string
    mobileColumns?: number
    fileUrl?: FileUrl
    className?: string
}

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
