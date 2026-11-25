import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

import { DomainsScreen } from '@/ee/components/organization/DomainsScreen'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { listOrganizationDomains } from '@/ee/services/organization-domains.service'
import { organizationRootDomain } from '@/lib/brand/root-domain'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.domains')
    return { title: t('title') }
}

export default async function DomainsPage() {
    const ctx = await openConsole()
    if (!organizationRootDomain()) notFound()
    return <DomainsScreen initial={await listOrganizationDomains(ctx)} />
}
