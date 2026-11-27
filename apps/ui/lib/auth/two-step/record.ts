import { z } from 'zod'

// A passkey the hub checks itself: Supabase's hosted auth has no WebAuthn second factor.
const storedPasskeySchema = z.object({
    id: z.string(),
    credentialId: z.string(),
    publicKey: z.string(),
    counter: z.number(),
    transports: z.array(z.string()).optional(),
    name: z.string(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
})

// `users.two_step`, read and written by the hub alone (see the migration 20261126120000_two_step.sql).
const twoStepRecordSchema = z.object({
    recovery: z.object({ factorId: z.string(), sealedSecret: z.string() }).optional(),
    salt: z.string().optional(),
    codes: z.array(z.object({ hash: z.string(), usedAt: z.string().nullable() })).optional(),
    passkeys: z.array(storedPasskeySchema).optional(),
    // The one WebAuthn ceremony under way, spent by the answer it was asked for.
    challenge: z.object({ value: z.string(), purpose: z.enum(['register', 'sign-in']), expiresAt: z.string() }).optional(),
})

export type TwoStepRecord = z.infer<typeof twoStepRecordSchema>
export type StoredPasskey = z.infer<typeof storedPasskeySchema>

export function readTwoStepRecord(raw: unknown): TwoStepRecord {
    const parsed = twoStepRecordSchema.safeParse(raw ?? {})
    return parsed.success ? parsed.data : {}
}

export const PASSKEY_NAME_MAX = 60

export const PASSKEY_MAX = 10

export const BACKUP_CODE_COUNT = 10
