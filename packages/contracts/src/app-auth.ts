import { z } from 'zod'

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

export const emailCodeRequestSchema = z.object({ email: z.string().trim().email().max(320) })

export const emailCodePreparedSchema = z.object({ mailed: z.boolean() })

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

export const ACCOUNT_DELETION_REAUTH_MS = 10 * 60_000
export const REAUTH_REQUIRED = 'reauth_required'
