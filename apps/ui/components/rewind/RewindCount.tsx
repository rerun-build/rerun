'use client'

import NumberFlow from '@number-flow/react'
import { useLocale } from 'next-intl'

import { cn } from '@/lib/utils'
import { useSettledValue } from './useSettledValue'

export function RewindCount({ value, delay = 0.3, suffix, prefix, className }: { value: number; delay?: number; suffix?: string; prefix?: string; className?: string }) {
    const locale = useLocale()
    const shown = useSettledValue(value, delay)
    return <NumberFlow value={shown} locales={locale} prefix={prefix} suffix={suffix} className={cn('tabular-nums', className)} />
}
