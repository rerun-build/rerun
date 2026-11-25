'use client'

import { useBrand } from '@/components/brand/BrandProvider'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { useSession } from '@/supabase/session/SessionProvider'

export type WorkspaceManager = { name: string; supportEmail: string | null }

// The organization that runs the workspace for its people, null where they run it themselves.
export function useWorkspaceManager(): WorkspaceManager | null {
    const { workspace } = useSession()
    const { name, supportEmail } = useBrand()
    return isManagedWorkspace(workspace) ? { name, supportEmail } : null
}
