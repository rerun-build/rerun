import { create } from 'zustand'

import type { SandboxArchiveState } from '@/app/api/_actions/workspace-restore.actions'

type SandboxArchiveStore = {
    workspaceId: number | null
    archive: SandboxArchiveState | null
    setArchive: (workspaceId: number, archive: SandboxArchiveState | null) => void
}

export const useSandboxArchiveStore = create<SandboxArchiveStore>(set => ({
    workspaceId: null,
    archive: null,
    setArchive: (workspaceId, archive) => set({ workspaceId, archive }),
}))
