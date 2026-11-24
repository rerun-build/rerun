export type KitSpecRow = { key: string; value: string; note?: string }

export function KitSpec({ rows }: { rows: KitSpecRow[] }) {
    const hasNotes = rows.some(row => row.note)
    return (
        <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-start">
                <tbody>
                    {rows.map(row => (
                        <tr key={row.key} className="border-b border-border last:border-b-0">
                            <th scope="row" className="w-56 px-4 py-2.5 align-top text-xs font-normal text-foreground/50">
                                {row.key}
                            </th>
                            <td className="px-4 py-2.5 align-top font-mono text-xs break-words text-foreground">{row.value}</td>
                            {hasNotes && <td className="hidden px-4 py-2.5 align-top text-xs text-foreground/40 md:table-cell">{row.note}</td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
