import { z } from 'zod'
import { isSetupAnswered, type AgentArchivePlan } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { patchAgent, planAgentArchive } from '@/lib/engine/client'
import { archiveWarnings, captureAgentArchive, isMissingRoute, staleExportError } from '@/lib/agents/capture-archive'
import { AppError } from '@/lib/i18n/action-error'
import { getSpaceConnection } from '@/app/api/_services/space.service'
import { selectAll, selectMany, selectSingle, type Filters } from '@/supabase/supabase-helpers'
import { removePrivateFiles, uploadPrivateFile } from '@/lib/storage/private'
import { connectorSkillSlugs, readRegistry } from '@/lib/services/registry'
import { resolveAgentConnectors } from './connectors'
import { agentsFromRow } from './document'
import { AGENT_ARCHIVE_BUCKET, agentKeyFromName, archivePath, archivesFromRow, projectAgent, type TemplateAgentArchive } from './archives'
import { pingTemplateRevalidate } from './write'

// The engine id stays server-side: the client only ever names an agent by its row id, and the
// capture re-resolves the folder it addresses from that row.
export type CaptureSourceAgent = {
    id: string
    name: string
    handle: string
    description: string
    status: Database['public']['Enums']['agent_status']
}
export type CaptureSourceSpace = { id: string; name: string | null; agents: CaptureSourceAgent[] }

const SOURCE_DESCRIPTION_LIMIT = 160

// Only spaces that actually hold an agent are worth offering as a capture source. A `null` scope
// means every workspace on the platform, which only the admin console is allowed to ask for.
export async function listCaptureSources(supabase: SupabaseClient<Database>, workspaceId: number | null = null): Promise<CaptureSourceSpace[]> {
    const agentScope: Filters<'agents'> = workspaceId === null ? {} : { workspace_id: workspaceId }
    const spaceScope: Filters<'spaces'> = workspaceId === null ? {} : { workspace_id: workspaceId }

    const agentColumns = ['id', 'name', 'handle', 'description', 'status', 'engine_agent_id', 'space_id'] as const
    const { data: agents } = await selectAll(supabase, 'agents', agentColumns, agentScope, { column: 'name' })
    const { data: spaces } = await selectAll(supabase, 'spaces', ['id', 'name'] as const, spaceScope, { column: 'name' })

    const bySpace = new Map<string, CaptureSourceAgent[]>()
    for (const agent of agents ?? []) {
        if (!agent.engine_agent_id || !agent.space_id) continue
        const list = bySpace.get(agent.space_id) ?? []
        list.push({
            id: agent.id,
            name: agent.name,
            handle: agent.handle ?? '',
            // The admin console asks for every workspace on the platform, so the payload is
            // trimmed here rather than at the row that renders it.
            description: (agent.description ?? '').slice(0, SOURCE_DESCRIPTION_LIMIT),
            status: agent.status,
        })
        bySpace.set(agent.space_id, list)
    }

    return (spaces ?? [])
        .filter(space => bySpace.has(space.id))
        .map(space => ({ id: space.id, name: space.name?.trim() || null, agents: bySpace.get(space.id) ?? [] }))
}

export type AgentCapturePlan = AgentArchivePlan & { agentRowId: string }

export async function planCapture(supabase: SupabaseClient<Database>, spaceId: string, agentIds: string[]): Promise<AgentCapturePlan[]> {
    const conn = await getSpaceConnection(spaceId)
    const { data: agents } = await selectMany(supabase, 'agents', ['id', 'engine_agent_id'] as const, { id: { in: agentIds }, space_id: spaceId })

    const plans: AgentCapturePlan[] = []
    for (const agent of agents ?? []) {
        if (!agent.engine_agent_id) continue
        try {
            plans.push({ ...(await planAgentArchive(conn, agent.engine_agent_id)), agentRowId: agent.id })
        } catch (err) {
            throw isMissingRoute(err) ? staleExportError() : err
        }
    }
    return plans
}

// `setup` is the answer to "does this agent need configuring after install?", asked again at the
// last moment a template author can still change it. It is written to the agent before its folder
// is archived, so the copy carries the answer and the instructions it implies.
export type CaptureSelection = { agentRowId: string; exclude: string[]; setup?: { required: boolean; prompt: string } }

// Declared once and parsed by all three entry points (admin action, expert action, MCP tool): a
// capture that forgets the field silently drops the answer the review just forced.
export const captureSetupSchema = z.object({ required: z.boolean(), prompt: z.string().default('') })

export type CaptureOutcome = { captured: number; warnings: string[] }

// The runtime half of a capture writes the archive; the editorial half rewrites the `agents`
// and `connectors` jsonb the public page already renders, so nothing about the landing has to
// change and the admin stops hand-authoring what the folder already knows.
export async function captureAgents(
    supabase: SupabaseClient<Database>,
    slug: string,
    spaceId: string,
    selections: CaptureSelection[],
): Promise<CaptureOutcome> {
    const conn = await getSpaceConnection(spaceId)
    const { data: template } = await selectSingle(supabase, 'templates', ['id', 'slug', 'agents', 'agent_archives'] as const, { slug })
    if (!template) throw new AppError('templateSlugNotFound', { slug })

    const agents = agentsFromRow.parse(template.agents)
    const archives = archivesFromRow.parse(template.agent_archives)

    // The engine id addresses a folder on the box, so it is resolved from the rows of this space
    // rather than taken from the caller: a forged one would archive an agent nothing here owns.
    const { data: sourceRows } = await selectMany(supabase, 'agents', ['id', 'engine_agent_id'] as const, {
        id: { in: selections.map(selection => selection.agentRowId) },
        space_id: spaceId,
    })
    const engineIds = new Map((sourceRows ?? []).flatMap(row => (row.engine_agent_id ? [[row.id, row.engine_agent_id] as const] : [])))
    // Resolved for the whole selection before the first upload: failing halfway would leave an
    // archive in the bucket that the row never gets to point at.
    if (selections.some(selection => !engineIds.has(selection.agentRowId))) {
        throw new AppError('selectedCoworkerLeftBox')
    }
    // Same reason, and before the first patch: an agent that needs setup but ships no instructions
    // arrives on its buyer's account with nothing to run, while the card still promises an install.
    if (selections.some(selection => selection.setup && !isSetupAnswered(selection.setup))) {
        throw new AppError('setupNeedsInstructions')
    }

    const warnings: string[] = []
    let captured = 0

    for (const selection of selections) {
        const engineAgentId = engineIds.get(selection.agentRowId) as string

        // Before the plan, so the archive and the editorial projection both describe the answer
        // the author just gave rather than the one the folder still held.
        if (selection.setup) {
            await patchAgent(conn, engineAgentId, {
                setup: { required: selection.setup.required, completedAt: new Date().toISOString() },
                install: selection.setup.required ? selection.setup.prompt : '',
            })
        }

        const { plan, bytes } = await captureAgentArchive(conn, engineAgentId, selection.exclude)

        // A re-capture is matched on the source agent, not on its name: the editorial copy
        // written against that entry has to survive a rename.
        const previousArchive = archives.find(entry => entry.engineAgentId === engineAgentId)
        const key = previousArchive?.agentKey ?? agentKeyFromName(plan.displayName || plan.name, agents.map(a => a.key))
        const existingIndex = agents.findIndex(agent => agent.key === key)
        const connectorSkills = connectorSkillSlugs(await readRegistry(conn, engineAgentId))
        const projected = projectAgent(plan, key, connectorSkills, existingIndex >= 0 ? agents[existingIndex] : undefined)

        if (existingIndex >= 0) agents[existingIndex] = projected
        else agents.push(projected)

        const path = archivePath(template.slug, key)
        await uploadPrivateFile(supabase, AGENT_ARCHIVE_BUCKET, path, bytes, 'application/gzip')

        const archive: TemplateAgentArchive = {
            agentKey: key,
            engineAgentId,
            path,
            bytes: bytes.byteLength,
            engineCommit: plan.engineCommit,
            capturedAt: new Date().toISOString(),
            strippedConfigKeys: plan.strippedConfigKeys,
            excludedPaths: selection.exclude,
            envKeys: plan.envKeys,
            mcpAuth: plan.mcpAuth,
            redactions: plan.redactions,
        }
        const archiveIndex = archives.findIndex(entry => entry.agentKey === key)
        if (archiveIndex >= 0) {
            // Paths carry a UUID, so the replacement never overwrites the previous object.
            await removePrivateFiles(supabase, AGENT_ARCHIVE_BUCKET, [archives[archiveIndex].path]).catch(() => {})
            archives[archiveIndex] = archive
        } else {
            archives.push(archive)
        }

        warnings.push(...archiveWarnings(plan, projected.name))
        captured++
    }

    const { connectors, warnings: connectorWarnings } = await resolveAgentConnectors(supabase, agents)
    warnings.push(...connectorWarnings)

    const { error } = await supabase
        .from('templates')
        .update<Database['public']['Tables']['templates']['Update']>({
            agents,
            connectors,
            agent_archives: archives,
            updated_at: new Date().toISOString(),
        })
        .eq('id', template.id)
    if (error) throw new Error(error.message)

    await pingTemplateRevalidate(template.slug, null, [])
    return { captured, warnings }
}

// An agent only exists because a capture archived its folder, so dropping it from the editorial
// list without deleting the archive would leave a `.tar.gz` nothing points at any more.
export async function removeCapturedAgent(supabase: SupabaseClient<Database>, slug: string, agentKey: string): Promise<void> {
    const { data: template } = await selectSingle(supabase, 'templates', ['id', 'slug', 'agents', 'agent_archives'] as const, { slug })
    if (!template) throw new AppError('templateSlugNotFound', { slug })

    const agents = agentsFromRow.parse(template.agents).filter(agent => agent.key !== agentKey)
    const archives = archivesFromRow.parse(template.agent_archives)
    const removed = archives.filter(entry => entry.agentKey === agentKey)

    // An object that is already gone must not keep the row pointing at it.
    await removePrivateFiles(supabase, AGENT_ARCHIVE_BUCKET, removed.map(entry => entry.path)).catch(() => {})

    // The connector list is the union of the remaining agents', so the ones this agent was the
    // last user of leave the public page with it.
    const { connectors } = await resolveAgentConnectors(supabase, agents)

    const { error } = await supabase
        .from('templates')
        .update<Database['public']['Tables']['templates']['Update']>({
            agents,
            connectors,
            agent_archives: archives.filter(entry => entry.agentKey !== agentKey),
            updated_at: new Date().toISOString(),
        })
        .eq('id', template.id)
    if (error) throw new Error(error.message)

    await pingTemplateRevalidate(template.slug, null, [])
}
