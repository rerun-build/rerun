import { useTranslations } from 'next-intl'
import { Logo } from '@/components/layout/Logo'
import { LinkedPair } from '@/components/ui/linked-pair'
import { appInfo } from '@/lib/apps/catalog'
import type { AppSlug } from '@/lib/apps/types'
import { AppIcon } from './PaidAppViews'

// The app and Rerun, linked: one path carries what the app sends in, the other what the coworkers
// send out.
export function AppRerunLink({ slug, className }: { slug: AppSlug; className?: string }) {
    const t = useTranslations('apps')
    return <LinkedPair left={<AppIcon slug={slug} size="lg" />} right={<Logo size="lg" />} label={t('linkedToRerun', { provider: appInfo(slug).providerLabel })} className={className} />
}
