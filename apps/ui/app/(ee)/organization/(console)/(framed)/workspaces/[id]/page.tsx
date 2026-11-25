import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { WorkspaceDetailScreen } from '@/ee/components/organization/WorkspaceDetailScreen'
import { openConsole, openConsoleWorkspace } from '@/ee/lib/organizations/console.server'
import { getCreditUsage } from '@/ee/services/credit-usage.service'
import { listOrganizationWorkspaceMembers } from '@/ee/services/organization-members.service'

type WorkspacePageProps = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: WorkspacePageProps): Promise<Metadata> {
    const { name } = await openConsoleWorkspace((await params).id)
    const t = await getTranslations('organization.workspaces')
    return { title: name || t('unnamed') }
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
    const ctx = await openConsole()
    const workspace = await openConsoleWorkspace((await params).id)
    // The slowest to read, and the last thing on the page: it comes when it comes.
    const usage = getCreditUsage(ctx.supabase, { kind: 'workspace', workspaceId: workspace.id }).catch(err => {
        console.error('[organizations] could not read the usage of a workspace', workspace.id, err)
        return null
    })
    const people = await listOrganizationWorkspaceMembers(ctx, workspace.id)
    return <WorkspaceDetailScreen key={workspace.id} initial={{ workspace }} initialPeople={people} usage={usage} />
}
