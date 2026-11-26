import 'server-only'

import type { Database } from '@/app/api/database.types'
import { claimAttempt } from '@/lib/rate-limit/attempts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { spendBackupCode } from './backup-codes'
import { elevateSession } from './recovery'
import { readTwoStep, writeTwoStep } from './store'

// A person gets ten tries every fifteen minutes at their backup codes.
const BACKUP_CODE_TRIES = 10
const BACKUP_CODE_WINDOW_SECONDS = 15 * 60

export type BackupSignIn = { ok: true; accessToken: string; refreshToken: string } | { ok: false; reason: 'wrong_code' | 'too_many' }

// The second step with a backup code: counted, spent once, then the session the client holds is
// raised to aal2 by the hub's recovery factor.
export async function signInWithBackupCode(client: SupabaseClient<Database>, userId: string, code: string): Promise<BackupSignIn> {
    if (!(await claimAttempt([`two-step:${userId}`], BACKUP_CODE_TRIES, BACKUP_CODE_WINDOW_SECONDS))) return { ok: false, reason: 'too_many' }
    const record = await readTwoStep(userId)
    const spent = spendBackupCode(record, code)
    if (!spent || !record.recovery) return { ok: false, reason: 'wrong_code' }
    await writeTwoStep(userId, spent)
    return { ok: true, ...(await elevateSession(client, record.recovery)) }
}
