import { z } from 'zod'

// `users.two_step`, read and written by the hub alone (see the migration 20261126120000_two_step.sql).
const twoStepRecordSchema = z.object({
    recovery: z.object({ factorId: z.string(), sealedSecret: z.string() }).optional(),
    salt: z.string().optional(),
    codes: z.array(z.object({ hash: z.string(), usedAt: z.string().nullable() })).optional(),
    names: z.record(z.string(), z.string()).optional(),
})

export type TwoStepRecord = z.infer<typeof twoStepRecordSchema>

export function readTwoStepRecord(raw: unknown): TwoStepRecord {
    const parsed = twoStepRecordSchema.safeParse(raw ?? {})
    return parsed.success ? parsed.data : {}
}

export const PASSKEY_NAME_MAX = 60

export const BACKUP_CODE_COUNT = 10
