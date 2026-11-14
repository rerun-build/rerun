import { z } from 'zod'

import { CLIENT_PLATFORMS, type ClientPlatform } from './client.js'
import { conversationMessageSchema } from './conversation.js'
import { TEMPLATE_CATEGORIES } from './template-display.js'

export const FOREMAN_AGENT_ID = 'foreman'

export const FOREMAN_DISPLAY_NAME = 'Chief of Staff'

export const FOREMAN_HUB_TOKEN_HEADER = 'x-rerun-foreman-token'

export const FOREMAN_INTENT_PART = 'data-foreman-intent'
export type ForemanIntent = { tool: string; input: unknown }

export const foremanToolSpecSchema = z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    kind: z.enum(['hub', 'intent']),
    serial: z.boolean().default(false),
})
export type ForemanToolSpec = z.infer<typeof foremanToolSpecSchema>

export const foremanBriefSchema = z.object({
    instructions: z.string().min(1),
    tools: z.array(foremanToolSpecSchema).max(64).default([]),
    hubToken: z.string().min(1).optional(),
})
export type ForemanBrief = z.infer<typeof foremanBriefSchema>

export const foremanSurfaceSchema = z.enum(['onboarding', 'engine', 'none'])
export type ForemanSurface = z.infer<typeof foremanSurfaceSchema>

export const FOREMAN_PHASES = ['waitlist', 'discover', 'plan', 'trial', 'build', 'companion'] as const
export const foremanPhaseSchema = z.enum(FOREMAN_PHASES)
export type ForemanPhase = z.infer<typeof foremanPhaseSchema>

export const foremanClientSchema = z.enum(['web', ...CLIENT_PLATFORMS])
export type ForemanClient = z.infer<typeof foremanClientSchema>

export function isMobileClient(client: ForemanClient | null | undefined): client is ClientPlatform {
    return (CLIENT_PLATFORMS as readonly string[]).includes(client ?? '')
}

export const foremanStateSchema = z.looseObject({ surface: foremanSurfaceSchema, phase: foremanPhaseSchema, firstName: z.string() })
export type ForemanStateResponse = z.infer<typeof foremanStateSchema>

export const foremanEngineConversationSchema = z
    .looseObject({ sessionId: z.string(), title: z.string().nullable().optional(), messages: z.array(conversationMessageSchema), activeRunId: z.string().nullable().optional() })
    .nullable()
export const foremanEngineMessagesSchema = z.object({ messages: z.array(conversationMessageSchema) })

const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES)

export const foremanIntakeSchema = z.object({
    companyUrl: z.string().trim().max(500).nullable(),
    industry: templateCategorySchema.nullable(),
    decidedIndustry: templateCategorySchema.nullable(),
    industryLabel: z.string().trim().max(200).nullable(),
    position: z.string().trim().max(200).nullable(),
    firstName: z.string().trim().max(100).nullable(),
})
export type ForemanIntakeRequest = z.infer<typeof foremanIntakeSchema>
export const foremanIndustryRequestSchema = z.object({ input: z.string().trim().min(1).max(500) })
export const foremanIndustryResultSchema = z.object({ industry: templateCategorySchema.nullable() })

export const foremanTrialResultSchema = z.object({ entitled: z.boolean() })
export type ForemanTrialResult = z.infer<typeof foremanTrialResultSchema>

export const foremanEngineFilesSchema = z.object({ supported: z.boolean() })
export type ForemanEngineFiles = z.infer<typeof foremanEngineFilesSchema>

export const foremanLeadRequestSchema = z.object({ agentId: z.string().min(1) })
export const foremanLeadResultSchema = z.object({ conversationId: z.string(), runId: z.string().nullable() })
