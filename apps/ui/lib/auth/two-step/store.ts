import 'server-only'

import type { Database, Json } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { readTwoStepRecord, type TwoStepRecord } from './record'

// A read that failed is never an account without methods: what decides on an empty record (the second
// step turned off, a record written over) would undo the account's two-step on a passing error.
export async function readTwoStep(userId: string): Promise<TwoStepRecord> {
    const { data, error } = await selectMaybeSingle(createServiceRoleClient(), 'users', ['two_step'] as const, { id: userId })
    if (error) throw new Error(error.message)
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
