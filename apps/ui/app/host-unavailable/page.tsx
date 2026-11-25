import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

import { HostNotice } from '@/components/brand/HostNotice'
import { requestSite } from '@/lib/brand/request-site'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('managed.host.unavailable')
    return { title: { absolute: t('title') }, robots: { index: false, follow: false } }
}

// Where the proxy leads every page of a suspended organization's address.
export default async function HostUnavailablePage() {
    const site = await requestSite()
    if (site.kind !== 'organization' || !site.suspended) notFound()
    const t = await getTranslations('managed.host.unavailable')
    return <HostNotice title={t('title')} message={t('body')} />
}
