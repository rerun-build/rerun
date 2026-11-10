'use client'

import { useTranslations } from 'next-intl'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipLabeled } from '@/components/ui/tooltip'
import type { CustomMcpStatus } from '@/lib/services/types'
import { Badge } from '@rerun/ui/primitives'

type CustomMcpStatusBadgeProps = {
    status: CustomMcpStatus | undefined
    loading: boolean
}

// The live answer of a custom server. An engine too old to probe, or a server the probe never
// reached, shows nothing rather than a guess.
export function CustomMcpStatusBadge({ status, loading }: CustomMcpStatusBadgeProps) {
    const t = useTranslations('services.customMcp.status')
    if (!status) return loading ? <Skeleton className="h-4 w-16 rounded-full" /> : null
    if (status.status === 'connected') {
        return (
            <Badge size="xs" tone="green" glow={false}>
                {t('connected', { count: status.toolCount })}
            </Badge>
        )
    }
    if (status.status === 'needs_auth') {
        return (
            <Badge size="xs" tone="orange" glow={false}>
                {t('needsAuth')}
            </Badge>
        )
    }
    if (status.status === 'error') {
        return (
            <TooltipLabeled label={status.error ?? t('noAnswer')}>
                <Badge size="xs" tone="red" glow={false}>
                    {t('unreachable')}
                </Badge>
            </TooltipLabeled>
        )
    }
    return null
}
