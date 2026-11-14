import { z } from 'zod'
import type { AgentArchivePlan } from './agent-archive.js'
import { templateAgentSchema, templateConnectorSchema } from './template.js'

export const agentShareIncludeSchema = z.object({
    memories: z.boolean().default(false),
    database: z.boolean().default(false),
    files: z.boolean().default(true),
})
export type AgentShareInclude = z.infer<typeof agentShareIncludeSchema>

export const AGENT_SHARE_INCLUDE_NONE: AgentShareInclude = { memories: false, database: false, files: false }

export function resolveShareInclude(input: unknown): AgentShareInclude {
    const sent = (input ?? {}) as Record<string, unknown>
    const named = (key: keyof AgentShareInclude): boolean => sent[key] === true
    return { memories: named('memories'), database: named('database'), files: named('files') }
}

const MEMORY_PREFIX = 'memory/'
const WORKSPACE_PREFIX = 'workspace/'
const AGENT_DB_PATH = 'data/agent.db'
const REGISTRY_PATH = 'workspace/.rerun/services.json'

export function shareExcludePaths(plan: AgentArchivePlan, include: AgentShareInclude): string[] {
    return plan.files
        .filter(file => {
            if (file.flagged.length > 0) return true
            if (file.path.startsWith(MEMORY_PREFIX)) return !include.memories
            if (file.path === AGENT_DB_PATH) return !include.database
            if (file.path === REGISTRY_PATH) return false
            if (file.path.startsWith(WORKSPACE_PREFIX)) return !include.files
            return false
        })
        .map(file => file.path)
}

export const shareBucketSchema = z.object({
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
})
export type ShareBucket = z.infer<typeof shareBucketSchema>
export type AgentShareContents = { memories: ShareBucket; database: ShareBucket; files: ShareBucket }

export function shareContents(plan: AgentArchivePlan): AgentShareContents {
    const bucket = (match: (path: string) => boolean): ShareBucket => {
        const entries = plan.files.filter(file => file.flagged.length === 0 && match(file.path))
        return { count: entries.length, bytes: entries.reduce((total, file) => total + file.bytes, 0) }
    }
    return {
        memories: bucket(path => path.startsWith(MEMORY_PREFIX)),
        database: bucket(path => path === AGENT_DB_PATH),
        files: bucket(path => path.startsWith(WORKSPACE_PREFIX) && path !== REGISTRY_PATH),
    }
}

export const agentSharePreviewSchema = z.object({
    agent: templateAgentSchema,
    connectors: z.array(templateConnectorSchema).default([]),
    envKeyCount: z.number().int().nonnegative().default(0),
    mcpAuthCount: z.number().int().nonnegative().default(0),
    include: agentShareIncludeSchema,
    contents: z.object({
        memories: shareBucketSchema,
        database: shareBucketSchema,
        files: shareBucketSchema,
    }),
    capturedAt: z.string(),
    sharedBy: z.string().nullable().default(null),
})
export type AgentSharePreview = z.infer<typeof agentSharePreviewSchema>
