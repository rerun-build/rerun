import { EmptyState } from '@/components/ui/empty-state'
import { BrainIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function BrainUnavailable() {
    const t = useTranslations('brain.unavailable')
    return <EmptyState icon={BrainIcon} title={t('title')} description={t('description')} />
}
