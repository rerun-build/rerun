import { z } from 'zod'
import { agentSetupSchema, providerSchema } from './agent.js'
import { triggerMethodSchema } from './trigger.js'

export const agentArchiveEntrySchema = z.object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    flagged: z.array(z.string()).default([]),
    defaultExcluded: z.boolean().default(false),
    note: z.string().default(''),
})
export type AgentArchiveEntry = z.infer<typeof agentArchiveEntrySchema>

export const agentArchiveRedactionSchema = z.object({ path: z.string(), reason: z.string() })
export type AgentArchiveRedaction = z.infer<typeof agentArchiveRedactionSchema>

export const agentArchiveMcpAuthSchema = z.object({
    server: z.string(),
    kind: z.enum(['oauth', 'managed', 'device', 'unknown']).default('unknown'),
})
export type AgentArchiveMcpAuth = z.infer<typeof agentArchiveMcpAuthSchema>

export const agentArchiveSkillSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().default(''),
})

export const agentArchiveScheduleSchema = z.object({
    slug: z.string(),
    name: z.string(),
    cron: z.string().nullable(),
})

export const agentArchiveTriggerSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().default(''),
    methods: z.array(triggerMethodSchema).default(['POST']),
    enabled: z.boolean().default(true),
})

export const agentArchivePlanSchema = z.object({
    agentId: z.string(),
    name: z.string(),
    displayName: z.string().default(''),
    description: z.string().default(''),
    provider: providerSchema,
    model: z.string(),
    tools: z.array(z.string()).default([]),
    files: z.array(agentArchiveEntrySchema).default([]),
    totalBytes: z.number().int().nonnegative(),
    connectorSlugs: z.array(z.string()).default([]),
    skills: z.array(agentArchiveSkillSchema).default([]),
    schedules: z.array(agentArchiveScheduleSchema).default([]),
    triggers: z.array(agentArchiveTriggerSchema).default([]),
    strippedConfigKeys: z.array(z.string()).default([]),
    envKeys: z.array(z.string()).default([]),
    mcpAuth: z.array(agentArchiveMcpAuthSchema).default([]),
    redactions: z.array(agentArchiveRedactionSchema).default([]),
    memoryCount: z.number().int().nonnegative().default(0),
    setup: agentSetupSchema.omit({ sessionId: true }).extend({ prompt: z.string().default('') }).prefault({}),
    engineCommit: z.string().nullable().default(null),
})
export type AgentArchivePlan = z.infer<typeof agentArchivePlanSchema>

export function defaultExcludedPaths(plan: AgentArchivePlan): string[] {
    return plan.files.filter(file => file.defaultExcluded).map(file => file.path)
}

export const agentImportResultSchema = z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string().default(''),
    description: z.string().default(''),
    soul: z.string().default(''),
    envKeys: z.array(z.string()).default([]),
    mcpAuth: z.array(agentArchiveMcpAuthSchema).default([]),
    connectorSlugs: z.array(z.string()).default([]),
    triggers: z.array(z.string()).default([]),
    memoriesIndexed: z.number().int().nonnegative().default(0),
    skippedPaths: z.array(z.string()).default([]),
})
export type AgentImportResult = z.infer<typeof agentImportResultSchema>
