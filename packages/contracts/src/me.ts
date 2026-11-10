import { z } from 'zod'

import { workspaceRoleSchema, workspaceSummarySchema } from './board.js'
import { clientPlatformSchema } from './client.js'

export const meSchema = z.object({
    user: z.object({
        id: z.string(),
        email: z.string().nullable(),
        name: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        // The language the account picked in the app (a short BCP 47 tag), null to follow the device.
        // Absent from a hub older than the language packs.
        locale: z.string().nullable().optional(),
    }),
    workspace: workspaceSummarySchema,
})
export type Me = z.infer<typeof meSchema>

// A member of the workspace as the chat signs their messages. The role is absent from a server older
// than roles.
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

// The app registers its push token on every launch (Expo can rotate it) and drops it on sign-out.
export const deviceTokenSchema = z.object({
    token: z.string().trim().regex(/^ExponentPushToken\[[\w-]+\]$/).max(256),
    platform: clientPlatformSchema,
    appVersion: z.string().max(64).optional(),
})
export type DeviceTokenInput = z.infer<typeof deviceTokenSchema>

// An id the app puts in a route or a hub path: a conversation, a coworker, `new`, `last`, the Foreman.
// Anything else in a deep link or a push is dropped, it would land in another path of the hub.
export const ROUTE_ID_PATTERN = /^[\w-]+$/

// What a push carries for the app to open the right conversation. `conversationId` is the hub's
// conversation, null for a run with no conversation of its own.
export const pushDataSchema = z.object({
    agentId: z.string().regex(ROUTE_ID_PATTERN).nullable(),
    conversationId: z.string().regex(ROUTE_ID_PATTERN).nullable(),
    kind: z.string(),
})
export type PushData = z.infer<typeof pushDataSchema>

// The Android notification channels the app creates before it asks for a token, and the hub names on
// each Android push. A push naming a channel the phone does not know is dropped, and only the
// channel's importance decides whether an Android push rings.
export const ANDROID_PUSH_CHANNELS = { messages: 'messages', silent: 'silent' } as const
export type AndroidPushChannel = (typeof ANDROID_PUSH_CHANNELS)[keyof typeof ANDROID_PUSH_CHANNELS]
