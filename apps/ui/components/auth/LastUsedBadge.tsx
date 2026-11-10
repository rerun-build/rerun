import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

export function LastUsedBadge() {
    const t = useTranslations('auth')
    return (
        <Badge size="xs" tone="brand">
            {t('lastUsed')}
        </Badge>
    )
}
