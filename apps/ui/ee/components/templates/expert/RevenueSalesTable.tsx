'use client'

import { formatAmount } from '@rerun/contracts'
import { formatDate } from '@rerun/i18n/format'
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@rerun/ui/primitives'
import type { CreatorRevenue } from '@/ee/services/creator-revenue.service'
import { saleKindLabel, saleKindTone } from '@/ee/lib/templates/payouts'
import { useLocale, useTranslations } from 'next-intl'

function dateLabel(iso: string, locale: string): string {
    return formatDate(iso, locale, { month: 'short', day: 'numeric' })
}

export function RevenueSalesTable({ revenue }: { revenue: CreatorRevenue }) {
    const t = useTranslations('templates.revenue')
    const tPayouts = useTranslations('templates.payouts')
    const locale = useLocale()
    if (revenue.recent.length === 0) return null

    return (
        <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('recentSales')}</p>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('date')}</TableHead>
                        <TableHead>{t('template')}</TableHead>
                        <TableHead>{t('type')}</TableHead>
                        <TableHead className="text-right">{t('youEarned')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {revenue.recent.map(sale => (
                        <TableRow key={sale.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground">{dateLabel(sale.occurredAt, locale)}</TableCell>
                            <TableCell className="max-w-40 truncate">{sale.title}</TableCell>
                            <TableCell>
                                <Badge tone={saleKindTone(sale.kind)} size="xs" glow={false} className="font-medium">
                                    {saleKindLabel(sale.kind, tPayouts)}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatAmount(sale.netCents, revenue.currency)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
