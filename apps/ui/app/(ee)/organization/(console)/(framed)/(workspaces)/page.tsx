import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { WorkspacesScreen } from '@/ee/components/organization/WorkspacesScreen'
import { openConsoleOverview, openConsoleSetup } from '@/ee/lib/organizations/console.server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.workspaces')
    return { title: t('title') }
}

export default async function WorkspacesPage() {
    const { workspaces } = await openConsoleOverview()
    return <WorkspacesScreen setup={workspaces.length === 0 ? await openConsoleSetup() : null} />
}
