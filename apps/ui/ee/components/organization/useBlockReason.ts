import { useTranslations } from 'next-intl'

import type { WriteBlock } from './types'

export function useBlockReason(block: WriteBlock | null): string | undefined {
    const t = useTranslations('organization.blocked')
    return block ? t(block) : undefined
}
