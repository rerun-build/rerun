import { useTranslations } from 'next-intl'
import { numericColumns, parseCsv } from '@/lib/published/csv'
import { TableIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ViewerPage, ViewerTopBar } from './ViewerChrome'

export const MAX_CSV_ROWS = 5000

export function CsvViewer({ slug, name, text, textTruncated }: { slug: string; name: string; text: string; textTruncated: boolean }) {
    const t = useTranslations('published.csv')
    const { rows, truncated } = parseCsv(text, { maxRows: MAX_CSV_ROWS + 1 })
    const [header = [], ...body] = rows
    const width = Math.max(header.length, ...body.map(row => row.length))
    const numeric = numericColumns(body)
    const cut = truncated || textTruncated
    const meta = t('meta', { rows: body.length, truncated: String(cut), columns: width })

    return (
        <ViewerPage slug={slug} bar={<ViewerTopBar icon={TableIcon} name={name} meta={meta} />} className="pb-20">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                    <tr>
                        <th className="sticky top-0 left-0 z-20 w-10 border-r border-b bg-muted px-2 py-2 text-right font-mono text-[11px] font-normal text-muted-foreground">#</th>
                        {Array.from({ length: width }, (_, c) => (
                            <th key={c} className={cn('sticky top-0 z-10 border-b bg-muted px-3 py-2 text-left font-medium whitespace-nowrap', numeric[c] && 'text-right')}>
                                {header[c] ?? ''}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {body.map((row, r) => (
                        <tr key={r} className="hover:bg-muted/40">
                            <td className="sticky left-0 border-r border-b bg-background px-2 py-2 text-right font-mono text-[11px] text-muted-foreground">{r + 1}</td>
                            {Array.from({ length: width }, (_, c) => (
                                <td key={c} className={cn('max-w-[28rem] truncate border-b px-3 py-2 whitespace-nowrap', numeric[c] && 'text-right tabular-nums')} title={row[c]}>
                                    {row[c] ?? ''}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {cut && <p className="px-4 py-3 text-xs text-muted-foreground">{t('truncated', { rows: body.length })}</p>}
        </ViewerPage>
    )
}
