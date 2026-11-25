import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { WorkspacesScreen } from '@/ee/components/organization/WorkspacesScreen'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { listOrganizationWorkspaces } from '@/ee/services/organization-workspaces.service'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.workspaces')
    return { title: t('title') }
}

export default async function WorkspacesPage() {
    const ctx = await openConsole()
    return <WorkspacesScreen initial={{ workspaces: await listOrganizationWorkspaces(ctx), maxWorkspaces: ctx.organization.max_workspaces }} />
}
