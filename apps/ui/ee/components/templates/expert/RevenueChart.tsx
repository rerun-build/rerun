'use client'

import { formatDate } from '@rerun/i18n/format'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { CreatorRevenue } from '@/ee/services/creator-revenue.service'

// One series, so no legend and one color: the question is "how much did I make each month", not a
// comparison between anything.

function monthLabel(month: string, locale: string): string {
    const date = new Date(`${month}-01T00:00:00`)
    return Number.isNaN(date.getTime()) ? month : formatDate(date, locale, { month: 'short', year: '2-digit' })
}

export function RevenueChart({ revenue }: { revenue: CreatorRevenue }) {
    const t = useTranslations('templates.revenue')
    const locale = useLocale()
    const chartConfig = useMemo<ChartConfig>(() => ({ net: { label: t('youEarned'), color: '#6366f1' } }), [t])
    const rows = useMemo(() => revenue.monthly.map(entry => ({ month: monthLabel(entry.month, locale), net: entry.netCents / 100 })), [revenue.monthly, locale])
    const formatValue = (value: number) => `$${Math.round(value)}`

    if (rows.length === 0) {
        return <div className="flex h-48 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-xs text-muted-foreground">{t('noSales')}</div>
    }

    return (
        <ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatValue} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="net" fill="var(--color-net)" radius={[3, 3, 0, 0]} />
            </BarChart>
        </ChartContainer>
    )
}
