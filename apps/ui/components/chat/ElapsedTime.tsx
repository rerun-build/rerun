'use client'

import { formatElapsed, useElapsed } from '@/hooks/useElapsed'

export function ElapsedTime({ active, className }: { active: boolean; className?: string }) {
    const seconds = useElapsed(active)
    if (seconds === undefined) return null
    return <span className={className}>{formatElapsed(seconds)}</span>
}
