'use server'

import type { FactorySnapshot } from '@moldwright/contracts'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { getFactorySnapshot } from '@/lib/factory/snapshot-store'

export async function readFactorySnapshotAction(): Promise<{ snapshot: FactorySnapshot; receivedAt: number; ageMs: number } | null> {
    const workspaceId = await requireWorkspaceId()
    const held = getFactorySnapshot(workspaceId)
    if (!held) return null
    return { snapshot: held.snapshot, receivedAt: held.receivedAt, ageMs: Date.now() - held.receivedAt }
}
