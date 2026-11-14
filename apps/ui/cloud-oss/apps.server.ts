import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import type { AppSlug } from './apps'

export async function unbindAgent(_supabase: SupabaseClient<Database>, _workspaceId: number, _agentId: string, _slug: AppSlug): Promise<void> {}

export async function paidAppFlag(_slug: AppSlug): Promise<boolean> {
    return false
}

export async function paidAppFlags(): Promise<Partial<Record<AppSlug, boolean>>> {
    return {}
}
