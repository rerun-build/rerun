import { z } from 'zod'

import { agentDetailSchema } from './agent.js'

export const workspaceRoleSchema = z.enum(['admin', 'member'])
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>

export const workspaceSummarySchema = z.object({
    id: z.number(),
    name: z.string().nullable(),
    iconUrl: z.string().nullable(),
    plan: z.string(),
    subscribed: z.boolean(),
    role: workspaceRoleSchema.optional(),
    boxScope: z.enum(['all', 'assigned']).optional(),
})
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>

export const boxVisibilitySchema = z.enum(['workspace', 'restricted'])
export type BoxVisibility = z.infer<typeof boxVisibilitySchema>

export const boxAccessSchema = z.enum(['use', 'manage'])
export type BoxAccessLevel = z.infer<typeof boxAccessSchema>

export const boxSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    createdAt: z.string().nullable(),
    managed: z.boolean(),
    visibility: boxVisibilitySchema.optional(),
    access: boxAccessSchema.optional(),
})
export type Box = z.infer<typeof boxSchema>

export const agentStatusSchema = z.enum(['idle', 'working', 'error', 'waiting_human', 'offline'])
export type AgentStatus = z.infer<typeof agentStatusSchema>

export const boardAgentSchema = z.object({
    id: z.string(),
    name: z.string(),
    handle: z.string().nullable(),
    description: z.string().nullable(),
    templateId: z.string().nullable(),
    status: agentStatusSchema,
    workspaceId: z.number(),
    spaceId: z.string(),
    disabledAt: z.string().nullable(),
    disabledReason: z.string().nullable(),
    access: boxAccessSchema.optional(),
})
export type BoardAgent = z.infer<typeof boardAgentSchema>

export const agentHealthSchema = z.record(z.string(), z.union([agentStatusSchema, z.literal('unconfigured')]))
export type AgentHealth = z.infer<typeof agentHealthSchema>

export const agentViewSchema = z.object({
    agent: boardAgentSchema,
    detail: agentDetailSchema.nullable(),
    locked: z.boolean(),
})
export type AgentView = z.infer<typeof agentViewSchema>
