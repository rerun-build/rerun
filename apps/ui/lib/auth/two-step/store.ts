import 'server-only'

import type { Database, Json } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { readTwoStepRecord, type TwoStepRecord } from './record'

export async function readTwoStep(userId: string): Promise<TwoStepRecord> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'users', ['two_step'] as const, { id: userId })
    return readTwoStepRecord(data?.two_step)
}

export async function writeTwoStep(userId: string, record: TwoStepRecord | null): Promise<void> {
    const { error } = await createServiceRoleClient()
        .from('users')
        .update<Database['public']['Tables']['users']['Update']>({ two_step: record as Json | null })
        .eq('id', userId)
    if (error) throw new Error(error.message)
}

// The flag every check reads in the token (see gate.ts). Supabase merges what it is handed into the
// stored metadata, so turning it off writes it as null.
export async function writeTwoStepFlag(userId: string, on: boolean): Promise<void> {
    const { error } = await createServiceRoleClient().auth.admin.updateUserById(userId, { app_metadata: { two_step: on ? true : null } })
    if (error) throw new Error(error.message)
}
