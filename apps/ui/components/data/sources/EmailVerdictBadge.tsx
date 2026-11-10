'use client'

import type { EmailVerdictStatus } from '@rerun/contracts'
import { Badge, type BadgeTone } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

export const EMAIL_VERDICT_TONES: Record<EmailVerdictStatus, BadgeTone> = {
    verified: 'green',
    unconfirmed: 'orange',
    invalid: 'red',
}

export function EmailVerdictBadge({ status, className }: { status: EmailVerdictStatus; className?: string }) {
    const t = useTranslations('data.sources.verdicts')
    return (
        <Badge size="xs" tone={EMAIL_VERDICT_TONES[status]} glow={false} className={className}>
            {t(`${status}.label`)}
        </Badge>
    )
}
