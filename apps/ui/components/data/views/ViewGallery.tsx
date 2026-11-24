'use client'

import type { DbRow } from '@/components/data/DataBrowserTable'
import { cn } from '@/lib/utils'
import type { TableView } from '@rerun/contracts'
import { GalleryItem, type CellContext } from '@rerun/ui/chat'

type ViewGalleryProps = { view: TableView; rows: DbRow[]; context: CellContext; onOpenRow?: (row: DbRow) => void }

export function ViewGallery({ view, rows, context, onOpenRow }: ViewGalleryProps) {
    const shape = view.display?.shape ?? 'square'
    return (
        <div className={cn('grid gap-3 p-3', shape === 'landscape' ? 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]')}>
            {rows.map((row, i) => {
                const item = <GalleryItem row={row} fields={view.fields ?? {}} formats={view.formats ?? {}} context={context} shape={shape} className="h-full" />
                if (!onOpenRow) return <div key={String(row.__rowid ?? i)}>{item}</div>
                return (
                    <button key={String(row.__rowid ?? i)} type="button" onClick={() => onOpenRow(row)} className="rounded-md text-start outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50">
                        {item}
                    </button>
                )
            })}
        </div>
    )
}
