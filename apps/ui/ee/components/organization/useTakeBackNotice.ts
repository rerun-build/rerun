import { creditsFromMicros } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import type { CreditTransfer } from './types'

// Its coworkers may have spent some of it meanwhile.
export function useTakeBackNotice() {
    const t = useTranslations('organization.credit')
    return ({ credits }: CreditTransfer, micros: number) => {
        const taken = creditsFromMicros(micros)
        if (taken < credits) toast.info(t('tookLess', { count: taken }))
    }
}
