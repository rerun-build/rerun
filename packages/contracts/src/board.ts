import { z } from 'zod'

import { agentDetailSchema } from './agent.js'
import { billingProviderSchema } from './store-billing.js'

// A member of the workspace. Admins run it (billing, members, keys, AI providers).
export const workspaceRoleSchema = z.enum(['admin', 'member'])
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>

export const workspaceSummarySchema = z.object({
    id: z.number(),
    name: z.string().nullable(),
    iconUrl: z.string().nullable(),
    plan: z.string(),
    // A subscription in force, a trial included: without one the workspace has no machine to run coworkers.
    subscribed: z.boolean(),
    // The caller's role in it. Absent from a server older than roles, where every member ran the
    // workspace.
    role: workspaceRoleSchema.optional(),
    // Whether a member uses every Box open to the workspace or only the ones named to them. Absent
    // from a server older than access by Box.
    boxScope: z.enum(['all', 'assigned']).optional(),
    // Who bills the workspace, null before anyone does: the app manages a store subscription in the
    // store it came from. Absent from a server older than store billing.
    billingProvider: billingProviderSchema.nullable().optional(),
    // On its free trial: what it runs on is the trial's credit until the plan's first month.
    trialing: z.boolean().optional(),
})
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>

// Who sees a Box: every member of the workspace, or only the people named on it.
export const boxVisibilitySchema = z.enum(['workspace', 'restricted'])
export type BoxVisibility = z.infer<typeof boxVisibilitySchema>

// The caller's level on a Box and on every coworker in it: `use` talks to them, `manage` changes
// what they are. A Box the caller cannot reach is never sent. Absent from an older server, where
// every member managed every Box.
export const boxAccessSchema = z.enum(['use', 'manage'])
export type BoxAccessLevel = z.infer<typeof boxAccessSchema>

export const boxSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    createdAt: z.string().nullable(),
    // Runs on an instance Rerun provisioned, as opposed to an engine the workspace hosts itself.
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
    // The caller's level on the coworker's Box.
    access: boxAccessSchema.optional(),
})
export type BoardAgent = z.infer<typeof boardAgentSchema>

// What each engine answered for its agents on the last poll. `unconfigured` is an agent whose Box
// has no engine behind it yet.
export const agentHealthSchema = z.record(z.string(), z.union([agentStatusSchema, z.literal('unconfigured')]))
export type AgentHealth = z.infer<typeof agentHealthSchema>

export const agentViewSchema = z.object({
    agent: boardAgentSchema,
    // Null for a switched-off agent: nothing on its Box answers for it.
    detail: agentDetailSchema.nullable(),
    // A template agent the workspace has not paid for: its soul arrives masked.
    locked: z.boolean(),
})
export type AgentView = z.infer<typeof agentViewSchema>
