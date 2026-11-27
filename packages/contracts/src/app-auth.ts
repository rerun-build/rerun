import { z } from 'zod'

// Sign-in from the iOS app. The hub answers a refusal with `error` to show and `reason` to count.

export const phoneChannelSchema = z.enum(['sms', 'whatsapp'])
export type PhoneChannel = z.infer<typeof phoneChannelSchema>

export const phoneCodeRequestSchema = z.object({
    phone: z.string().trim().min(1).max(32),
    country: z.string().length(2),
    channel: phoneChannelSchema,
})
export type PhoneCodeRequest = z.infer<typeof phoneCodeRequestSchema>

export const phoneCodeSentSchema = z.object({ channel: phoneChannelSchema })

export const phoneSignInRequestSchema = phoneCodeRequestSchema.extend({ code: z.string().trim().min(4).max(10) })
export type PhoneSignInRequest = z.infer<typeof phoneSignInRequestSchema>

export const appSessionSchema = z.object({
    created: z.boolean(),
    session: z.object({ accessToken: z.string(), refreshToken: z.string() }),
})
export type AppSession = z.infer<typeof appSessionSchema>

// The hidden factor the hub signs in with on an account with two-step verification: every list of
// the person's methods leaves it out by this name.
export const TWO_STEP_RECOVERY_FACTOR_NAME = 'rerun-recovery'

// The second step of a sign-in with two-step verification, by a backup code: the app hands its own
// session over (the access token as its bearer, the refresh token here), the hub raises it to aal2
// and gives it back.
export const backupCodeRequestSchema = z.object({ code: z.string().trim().min(8).max(20), refreshToken: z.string().min(1) })
export const raisedSessionSchema = z.object({ session: z.object({ accessToken: z.string(), refreshToken: z.string() }) })
export type RaisedSession = z.infer<typeof raisedSessionSchema>

// The second step by a passkey, checked by the hub: the options of a WebAuthn sign-in (every passkey
// of the account, null when it has none or this hub cannot offer them), then the device's signed
// answer, handed over with the session like a backup code. Both in the WebAuthn JSON form.
export const passkeyRequestOptionsSchema = z.object({
    challenge: z.string(),
    rpId: z.string().optional(),
    timeout: z.number().optional(),
    userVerification: z.enum(['required', 'preferred', 'discouraged']).optional(),
    allowCredentials: z.array(z.object({ id: z.string(), type: z.literal('public-key'), transports: z.array(z.string()).optional() })).optional(),
})
export const passkeyOptionsSchema = z.object({ options: passkeyRequestOptionsSchema.nullable() })
export type PasskeyOptions = z.infer<typeof passkeyOptionsSchema>
export const passkeyAssertionSchema = z.object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string(), userHandle: z.string().nullish() }),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullish(),
})
export const passkeySignInRequestSchema = z.object({ assertion: passkeyAssertionSchema, refreshToken: z.string().min(1) })

export const emailCodeRequestSchema = z.object({ email: z.string().trim().email().max(320) })

// `mailed` when the hub sent the code still good for this address again, or holds it back because it
// left less than a minute ago. Otherwise the app asks Supabase for a new one. Whether the address had
// an account is not said here: that would tell anyone who holds one, before any code is checked.
export const emailCodePreparedSchema = z.object({ mailed: z.boolean() })
export type EmailCodePrepared = z.infer<typeof emailCodePreparedSchema>

export const signInRefusalSchema = z.object({
    error: z.string(),
    reason: z.string(),
    retryAfterSeconds: z.number().optional(),
})
export type SignInRefusal = z.infer<typeof signInRefusalSchema>

export const accountDeletionStatusSchema = z.object({
    blockers: z.array(z.object({ workspaceId: z.number(), name: z.string() })),
})

export const deleteAccountRequestSchema = z.object({ confirmation: z.literal('DELETE') })

// Deleting the account needs a sign-in this recent: a stolen token alone does not destroy anything.
export const ACCOUNT_DELETION_REAUTH_MS = 10 * 60_000
export const REAUTH_REQUIRED = 'reauth_required'
