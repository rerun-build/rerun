'use client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Icon } from '@/components/ui/icon'
import { ShieldCheck } from '@/lib/icons'
import { useTranslations } from 'next-intl'

// The three switches above only ever widen what travels; nothing turns this off. Saying so under
// them is what makes the switches safe to flip, and it is the same promise the template library
// makes to someone about to import a stranger's agent.
export function ShareAgentSafety() {
    const t = useTranslations('agent.shareAgentSafety')
    return (
        <Alert variant="warning" stripes className="grid-cols-[auto_1fr] gap-x-3 gap-y-0">
            <Icon icon={ShieldCheck} size="sm" className="row-span-2 self-center" />
            <AlertTitle className="col-start-2 leading-tight">{t('title')}</AlertTitle>
            <AlertDescription className="col-start-2 leading-snug">
                {t('description')}
            </AlertDescription>
        </Alert>
    )
}
