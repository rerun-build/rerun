'use client'

import { isPaid, priceLabel, type TemplatePricing } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import type { PurchaseAccess } from '@/lib/templates/entitlement'
import { cn } from '@/lib/utils'

// What the workspace holds wins over what the template costs: once bought, the price is history.
// A free template gets no pill at all, since one on every card would be noise; the detail panel
// states it in its meta rows instead.
export function TemplatePriceBadge({ pricing, access, className }: { pricing: TemplatePricing; access?: PurchaseAccess; className?: string }) {
    const t = useTranslations('templates.price')
    const locale = useLocale()
    if (!isPaid(pricing)) return null

    const shared = cn('font-medium', className)

    if (access === 'active') {
        return (
            <Badge tone="green" size="xs" glow={false} className={shared}>
                {t('purchased')}
            </Badge>
        )
    }

    if (access === 'lapsed') {
        return (
            <Badge tone="orange" size="xs" glow={false} className={shared}>
                {t('expired')}
            </Badge>
        )
    }

    return (
        <Badge tone={pricing.model === 'recurring' ? 'cyan' : 'brand'} size="xs" glow={false} className={shared}>
            {priceLabel(pricing, t, locale)}
        </Badge>
    )
}
