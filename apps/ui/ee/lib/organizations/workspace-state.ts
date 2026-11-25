import { isMachineEntitled } from '@/ee/lib/billing/entitlement'

// Where a workspace of an organization stands, as its console tells it. `suspended`: cut off with the
// whole organization, not put away on its own.
export type OrganizationWorkspaceStatus = 'active' | 'archived' | 'suspended'

export function organizationWorkspaceStatus(workspace: { subscription_status: string | null; organization_archived_at: string | null }): OrganizationWorkspaceStatus {
    if (workspace.organization_archived_at) return 'archived'
    return isMachineEntitled(workspace.subscription_status) ? 'active' : 'suspended'
}

// `none`: nobody has put a coworker to work yet, so no machine was taken for it.
export type OrganizationMachineState = 'none' | 'running' | 'archiving' | 'archived' | 'restoring' | 'error'

type MachineInput = {
    status: OrganizationWorkspaceStatus
    boxesArchivedAt: string | null
    instance: { status: string; provider_server_id: string | null } | null
    // Of the workspace's latest archive.
    archiveStatus: string | null
}

export function organizationMachineState({ status, boxesArchivedAt, instance, archiveStatus }: MachineInput): OrganizationMachineState {
    if (archiveStatus === 'archiving') return 'archiving'
    if (archiveStatus === 'restoring') return 'restoring'
    if (boxesArchivedAt) {
        // Restored, yet still flagged: the restored engine failed its check and waits for a person.
        if (archiveStatus === 'restored') return 'error'
        return status === 'active' ? 'restoring' : 'archived'
    }
    if (!instance) return 'none'
    // A machine somebody else runs is never archived: only its access is cut.
    if (status !== 'active') return instance.provider_server_id ? 'archiving' : 'archived'
    return instance.status === 'error' ? 'error' : 'running'
}
