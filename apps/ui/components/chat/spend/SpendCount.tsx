'use client'

import NumberFlow from '@number-flow/react'
import { useLocale } from 'next-intl'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

// Starts from 0 and moves to `value` on the next tick, so the first amount is seen counting up.
export function SpendCount({ value, className }: { value: number; className?: string }) {
    const locale = useLocale()
    const [shown, setShown] = useState(0)

    useEffect(() => {
        const timer = setTimeout(() => setShown(value), 0)
        return () => clearTimeout(timer)
    }, [value])

    return <NumberFlow value={shown} locales={locale} className={cn('tabular-nums', className)} />
}
