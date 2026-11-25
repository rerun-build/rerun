import { AuthorizationError } from '@/app/api/_auth/errors'
import { getServerSession } from '@/supabase/session/getServerSession'
import { isManagedWorkspace } from '@/lib/workspace/managed'

export function refuseManagedWorkspace(workspace: { organization_id?: string | null } | null | undefined): void {
    if (isManagedWorkspace(workspace)) throw new AuthorizationError('managedWorkspace')
}

// For a caller that holds no more of the session than the workspace's id.
export async function refuseManagedSession(): Promise<void> {
    refuseManagedWorkspace((await getServerSession()).workspace)
}
