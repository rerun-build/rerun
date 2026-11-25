import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { CreditScreen } from '@/ee/components/organization/CreditScreen'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { loadOrganizationCredit } from '@/ee/services/organization-credit.service'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.credit')
    return { title: t('title') }
}

export default async function CreditPage() {
    return <CreditScreen initial={await loadOrganizationCredit(await openConsole())} />
}
