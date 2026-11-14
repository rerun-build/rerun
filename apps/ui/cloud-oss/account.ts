import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'

type Client = SupabaseClient<Database>

export async function subscriptionStillCharges(_subscriptionId: string): Promise<boolean> {
    return false
}

export async function stopWorkspaceCharges(_admin: Client, _workspace: { id: number; name: string; isSandbox: boolean; stripeCustomerId: string | null }): Promise<void> {}

export async function uninstallWorkspaceApps(_admin: Client, _workspaceId: number): Promise<void> {}
