'use client'

import { isStableLocale } from '@rerun/i18n'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createOrganizationWorkspaceAction, listOrganizationWorkspacesAction } from '@/ee/actions/organization.actions'
import { consoleWorkspacePath } from '@/ee/lib/organizations/console-routes'
import type { OrganizationWorkspaceSummary } from '@/ee/services/organization-workspaces.service'

import { consoleWorkspaceOf } from './console-data'
import { useWriteBlock } from './ConsoleProvider'
import { CreateWorkspaceDialog, type NewWorkspace } from './CreateWorkspaceDialog'
import { consoleStatusOf, isBusy } from './types'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'
import { WorkspacesView } from './WorkspacesView'

type WorkspaceList = { workspaces: OrganizationWorkspaceSummary[]; maxWorkspaces: number }

const anyBusy = ({ workspaces }: WorkspaceList) => workspaces.some(workspace => isBusy(consoleStatusOf(workspace)))

export function WorkspacesScreen({ initial }: { initial: WorkspaceList }) {
    const t = useTranslations('organization.workspaces')
    const locale = useLocale()
    const router = useRouter()
    const block = useWriteBlock()
    const { data, reload } = useConsoleData(initial, listOrganizationWorkspacesAction, { waiting: anyBusy })
    const { submit } = useConsoleChange(reload)
    const [creating, setCreating] = useState(false)

    const open = (workspaceId: number) => router.push(consoleWorkspacePath(workspaceId))

    const create = ({ name, adminEmail, logo }: NewWorkspace) => {
        const form = new FormData()
        form.append('name', name)
        form.append('adminEmail', adminEmail)
        if (isStableLocale(locale)) form.append('locale', locale)
        if (logo) form.append('logoFile', logo)
        return submit(() => createOrganizationWorkspaceAction(form))
    }

    return (
        <>
            <WorkspacesView workspaces={data.workspaces.map(workspace => consoleWorkspaceOf(workspace, t('unnamed')))} maxWorkspaces={data.maxWorkspaces} block={block} onOpen={workspace => open(workspace.id)} onNew={() => setCreating(true)} />
            <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={create} onView={open} />
        </>
    )
}
