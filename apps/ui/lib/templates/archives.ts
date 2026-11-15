import { agentArchiveMcpAuthSchema, agentArchiveRedactionSchema, type AgentArchivePlan, type TemplateAgent } from '@rerun/contracts'
import { z } from 'zod'
import { randomUuid } from '@/lib/random-uuid'

export const AGENT_ARCHIVE_BUCKET = 'agent-archives'

export const templateAgentArchiveSchema = z.object({
    agentKey: z.string(),
    engineAgentId: z.string().default(''),
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    engineCommit: z.string().nullable().default(null),
    capturedAt: z.string(),
    strippedConfigKeys: z.array(z.string()).default([]),
    excludedPaths: z.array(z.string()).default([]),
    envKeys: z.array(z.string()).default([]),
    mcpAuth: z.array(agentArchiveMcpAuthSchema).default([]),
    redactions: z.array(agentArchiveRedactionSchema).default([]),
})
export type TemplateAgentArchive = z.infer<typeof templateAgentArchiveSchema>

export const archivesFromRow = z.array(templateAgentArchiveSchema).catch([])

export function archiveAgentNames(archives: TemplateAgentArchive[], agents: TemplateAgent[]): string[] {
    return archives.map(archive => agents.find(agent => agent.key === archive.agentKey)?.name ?? archive.agentKey)
}

export function archivePath(templateSlug: string, agentKey: string): string {
    return `${templateSlug}/${agentKey}/${randomUuid()}.tar.gz`
}

export function agentKeyFromName(name: string, taken: string[]): string {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^([^a-z])/, 'a$1')
    const candidate = base || 'agent'
    if (!taken.includes(candidate)) return candidate
    for (let i = 2; ; i++) {
        if (!taken.includes(`${candidate}_${i}`)) return `${candidate}_${i}`
    }
}

export function projectAgent(plan: AgentArchivePlan, key: string, connectorSkills: Set<string>, previous?: TemplateAgent): TemplateAgent {
    return {
        key,
        name: plan.displayName || plan.name,
        role: previous?.role ?? '',
        description: plan.description || (previous?.description ?? ''),
        connectorSlugs: plan.connectorSlugs,
        setupRequired: plan.setup.required,
        skills: plan.skills.filter(skill => !connectorSkills.has(skill.slug)).map(({ name, description }) => ({ name, description })),
        schedules: plan.schedules.filter(s => s.cron).map(s => ({ name: s.name, cron: s.cron as string })),
        triggers: plan.triggers.filter(t => t.enabled).map(({ name, description, methods }) => ({ name, description, methods })),
        tools: plan.tools,
    }
}
