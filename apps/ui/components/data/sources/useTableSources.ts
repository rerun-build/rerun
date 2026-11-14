'use client'

import type { DataSource } from '@/lib/data/source'
import { TABLE_SOURCES_MAX_ROWS } from '@rerun/contracts'
import { useCallback, useEffect, useState } from 'react'
import { resolveTableSources, sourcesRequestRows, type RowSources } from './table-sources'

type Row = Record<string, unknown>

type Answer = { table: string; rows: readonly Row[]; byRow: Map<Row, RowSources>; byRowid: Map<string, RowSources> }

const rowidOf = (row: Row): string | null => (row.__rowid === undefined || row.__rowid === null ? null : String(row.__rowid))

export function useTableSources(source: DataSource, table: string | null, rows: readonly Row[]) {
    const [answer, setAnswer] = useState<Answer | null>(null)
    const asks = Boolean(source.readSources && table && rows.length > 0)
    const pending = asks && (answer?.rows !== rows || answer.table !== table)

    useEffect(() => {
        const read = source.readSources
        if (!read || !table || rows.length === 0) return
        let cancelled = false
        const asked = rows.slice(0, TABLE_SOURCES_MAX_ROWS)
        read(table, sourcesRequestRows(asked))
            .catch(() => null)
            .then(result => {
                if (cancelled) return
                const resolved = result ? resolveTableSources(result, asked.length) : []
                setAnswer(current => {
                    const byRow = new Map<Row, RowSources>()
                    const byRowid = new Map(current?.table === table ? current.byRowid : [])
                    asked.forEach((row, index) => {
                        const rowid = rowidOf(row)
                        const found = resolved[index]
                        if (found) byRow.set(row, found)
                        if (rowid === null) return
                        if (found) byRowid.set(rowid, found)
                        else byRowid.delete(rowid)
                    })
                    return { table, rows, byRow, byRowid }
                })
            })
        return () => {
            cancelled = true
        }
    }, [source, table, rows])

    const sourcesOf = useCallback(
        (row: Row | null | undefined): RowSources | null => {
            if (!row || !answer || answer.table !== table) return null
            const exact = answer.byRow.get(row)
            if (exact) return exact
            const rowid = rowidOf(row)
            return rowid === null ? null : (answer.byRowid.get(rowid) ?? null)
        },
        [answer, table]
    )

    return { sourcesOf, pending }
}
