import { useTranslations } from 'next-intl'
import { Logo } from '@/components/layout/Logo'
import { LinkedPair } from '@/components/ui/linked-pair'
import { appInfo } from '@/lib/apps/catalog'
import type { AppSlug } from '@/lib/apps/types'
import { AppIcon } from './PaidAppViews'

export function AppMoldwrightLink({ slug, className }: { slug: AppSlug; className?: string }) {
    const t = useTranslations('apps')
    return <LinkedPair left={<AppIcon slug={slug} size="lg" />} right={<Logo size="lg" />} label={t('linkedToRerun', { provider: appInfo(slug).providerLabel })} className={className} />
}
