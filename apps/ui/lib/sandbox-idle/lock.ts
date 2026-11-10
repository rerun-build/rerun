// Whether a sandbox is waiting on us. Nothing stores this: it is read off the archive the sandbox
// was last put away in, and that row outlives the purge of an expired archive, so a sandbox whose
// data is long gone still does not get a fresh machine without an approval.
import type { Database } from '@/app/api/database.types'

type ArchiveRow = Database['public']['Tables']['workspace_archives']['Row']

export type LockArchive = Pick<ArchiveRow, 'reason' | 'status' | 'reactivation_requested_at' | 'reactivation_approved_at' | 'reactivation_rejected_at'>

export const LOCK_ARCHIVE_COLUMNS = ['id', 'workspace_id', 'reason', 'status', 'archived_at', 'expires_at', 'reactivation_requested_at', 'reactivation_approved_at', 'reactivation_rejected_at'] as const

/**
 * `archive` is the sandbox's latest completed archive. A restore that passed lifts the lock on its
 * own, which is what makes an admin restoring by hand an approval like any other.
 */
export function isSandboxLocked(archive: LockArchive | null | undefined): boolean {
    if (!archive || archive.reason !== 'inactivity') return false
    return archive.status !== 'restored' && !archive.reactivation_approved_at
}

export type ReactivationState = 'none' | 'requested' | 'rejected' | 'approved'

export function reactivationStateOf(archive: LockArchive | null | undefined): ReactivationState {
    if (!archive) return 'none'
    if (archive.reactivation_approved_at) return 'approved'
    if (archive.reactivation_rejected_at) return 'rejected'
    return archive.reactivation_requested_at ? 'requested' : 'none'
}
