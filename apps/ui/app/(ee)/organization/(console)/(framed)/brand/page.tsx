import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { BrandScreen } from '@/ee/components/organization/BrandScreen'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { loadOrganizationBrandSettings } from '@/ee/services/organization-settings.service'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.brand')
    return { title: t('title') }
}

export default async function BrandPage() {
    return <BrandScreen initial={await loadOrganizationBrandSettings(await openConsole())} />
}
