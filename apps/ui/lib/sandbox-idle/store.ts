import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'
import { LOCK_ARCHIVE_COLUMNS } from './lock'

export type SandboxArchive = Pick<Database['public']['Tables']['workspace_archives']['Row'], (typeof LOCK_ARCHIVE_COLUMNS)[number]>

export async function loadSandboxArchive(supabase: SupabaseClient<Database>, workspaceId: number): Promise<SandboxArchive | null> {
    const { data } = await selectMany(supabase, 'workspace_archives', LOCK_ARCHIVE_COLUMNS, { workspace_id: workspaceId, archived_at: { notNull: true } }, { column: 'archived_at', ascending: false }, 1)
    return data?.[0] ?? null
}
