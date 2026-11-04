import { agentArchiveMcpAuthSchema, agentArchiveRedactionSchema, type AgentArchivePlan, type TemplateAgent } from '@rerun/contracts'
import { randomUuid } from '@rerun/db/helpers'
import { z } from 'zod'

export const AGENT_ARCHIVE_BUCKET = 'agent-archives'

// One captured agent folder. Written only by the capture action: it is not part of the
// editorial document, so saving the admin form can never clobber it.
export const templateAgentArchiveSchema = z.object({
    // Ties the archive to its entry in the editorial `agents` list.
    agentKey: z.string(),
    // The agent this was captured from, so re-capturing it updates its entry in place instead
    // of appending a second one. Renaming the source agent must not orphan the archive.
    engineAgentId: z.string().default(''),
    // Object path inside the private bucket, not a URL.
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    // Which engine build produced it, so a stale archive can be spotted after an engine change.
    engineCommit: z.string().nullable().default(null),
    capturedAt: z.string(),
    // config.json entries whose literal value the engine replaced with a `${VAR}` reference.
    strippedConfigKeys: z.array(z.string()).default([]),
    // Files the admin dropped in the security review.
    excludedPaths: z.array(z.string()).default([]),
    // The archive ships `.env` with its key names and no values, so installing this template
    // means asking for these again. Names only: a value never reaches Supabase.
    envKeys: z.array(z.string()).default([]),
    // MCP servers whose OAuth bundle stayed on the source engine.
    mcpAuth: z.array(agentArchiveMcpAuthSchema).default([]),
    // What the engine rewrote on the way out, kept so the archive can be audited later without
    // unpacking it.
    redactions: z.array(agentArchiveRedactionSchema).default([]),
})
export type TemplateAgentArchive = z.infer<typeof templateAgentArchiveSchema>

export const archivesFromRow = z.array(templateAgentArchiveSchema).catch([])

// The archives are the canonical order of an install, and the order the importer places tiles in.
// The editorial list only supplies display names; an archive with no editorial entry falls back to
// its key.
export function archiveAgentNames(archives: TemplateAgentArchive[], agents: TemplateAgent[]): string[] {
    return archives.map(archive => agents.find(agent => agent.key === archive.agentKey)?.name ?? archive.agentKey)
}

export function archivePath(templateSlug: string, agentKey: string): string {
    return `${templateSlug}/${agentKey}/${randomUuid()}.tar.gz`
}

// Agent keys are the stable identifier behind React keys and board tiles, so a re-capture
// of the same agent has to land on the same key.
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

// The editorial half of a capture. Everything the public page renders about an agent comes
// from the folder we just archived, so the admin no longer hand-writes it: only `role` and
// the marketing copy stay manual, and a re-capture must not wipe them.
export function projectAgent(plan: AgentArchivePlan, key: string, connectorSkills: Set<string>, previous?: TemplateAgent): TemplateAgent {
    return {
        key,
        name: plan.displayName || plan.name,
        role: previous?.role ?? '',
        description: plan.description || (previous?.description ?? ''),
        connectorSlugs: plan.connectorSlugs,
        setupRequired: plan.setup.required,
        // Installing a connector writes its own skills into the agent folder, and the public card
        // already shows that connector's icon: listing "stripe-usage" under it says nothing more.
        // The slug is the only join key back to the registry, and it stops here.
        skills: plan.skills.filter(skill => !connectorSkills.has(skill.slug)).map(({ name, description }) => ({ name, description })),
        // A one-shot schedule has no cron expression and nothing to show on a public page.
        schedules: plan.schedules.filter(s => s.cron).map(s => ({ name: s.name, cron: s.cron as string })),
        // A webhook left switched off in the workshop is a draft, not a promise the page should
        // make. The URL and the instruction stay out: one is a secret, the other is the archive's.
        triggers: plan.triggers.filter(t => t.enabled).map(({ name, description, methods }) => ({ name, description, methods })),
        tools: plan.tools,
    }
}
