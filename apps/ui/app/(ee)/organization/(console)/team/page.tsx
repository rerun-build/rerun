import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { TeamScreen } from '@/ee/components/organization/TeamScreen'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { listOrganizationTeam } from '@/ee/services/organization-team.service'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.team')
    return { title: t('title') }
}

export default async function TeamPage() {
    return <TeamScreen initial={await listOrganizationTeam(await openConsole())} />
}
