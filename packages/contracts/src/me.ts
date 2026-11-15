import { z } from 'zod'

import { workspaceRoleSchema, workspaceSummarySchema } from './board.js'
import { clientPlatformSchema } from './client.js'

export const meSchema = z.object({
    user: z.object({
        id: z.string(),
        email: z.string().nullable(),
        name: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        locale: z.string().nullable().optional(),
    }),
    workspace: workspaceSummarySchema,
})
export type Me = z.infer<typeof meSchema>

export const memberProfileSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    role: workspaceRoleSchema.optional(),
})
export type MemberProfile = z.infer<typeof memberProfileSchema>

export const apiErrorSchema = z.object({
    error: z.string(),
})

export const deviceTokenSchema = z.object({
    token: z.string().trim().regex(/^ExponentPushToken\[[\w-]+\]$/).max(256),
    platform: clientPlatformSchema,
    appVersion: z.string().max(64).optional(),
})
export type DeviceTokenInput = z.infer<typeof deviceTokenSchema>

export const ROUTE_ID_PATTERN = /^[\w-]+$/

export const pushDataSchema = z.object({
    agentId: z.string().regex(ROUTE_ID_PATTERN).nullable(),
    conversationId: z.string().regex(ROUTE_ID_PATTERN).nullable(),
    kind: z.string(),
})
export type PushData = z.infer<typeof pushDataSchema>

export const ANDROID_PUSH_CHANNELS = { messages: 'messages', silent: 'silent' } as const
export type AndroidPushChannel = (typeof ANDROID_PUSH_CHANNELS)[keyof typeof ANDROID_PUSH_CHANNELS]
