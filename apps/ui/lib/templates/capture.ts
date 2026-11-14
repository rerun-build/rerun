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

export type CaptureSourceAgent = {
    id: string
    name: string
    handle: string
    description: string
    status: Database['public']['Enums']['agent_status']
}
export type CaptureSourceSpace = { id: string; name: string | null; agents: CaptureSourceAgent[] }

const SOURCE_DESCRIPTION_LIMIT = 160

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

export type CaptureSelection = { agentRowId: string; exclude: string[]; setup?: { required: boolean; prompt: string } }

export const captureSetupSchema = z.object({ required: z.boolean(), prompt: z.string().default('') })

export type CaptureOutcome = { captured: number; warnings: string[] }

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

    const { data: sourceRows } = await selectMany(supabase, 'agents', ['id', 'engine_agent_id'] as const, {
        id: { in: selections.map(selection => selection.agentRowId) },
        space_id: spaceId,
    })
    const engineIds = new Map((sourceRows ?? []).flatMap(row => (row.engine_agent_id ? [[row.id, row.engine_agent_id] as const] : [])))
    if (selections.some(selection => !engineIds.has(selection.agentRowId))) {
        throw new AppError('selectedCoworkerLeftBox')
    }
    if (selections.some(selection => selection.setup && !isSetupAnswered(selection.setup))) {
        throw new AppError('setupNeedsInstructions')
    }

    const warnings: string[] = []
    let captured = 0

    for (const selection of selections) {
        const engineAgentId = engineIds.get(selection.agentRowId) as string

        if (selection.setup) {
            await patchAgent(conn, engineAgentId, {
                setup: { required: selection.setup.required, completedAt: new Date().toISOString() },
                install: selection.setup.required ? selection.setup.prompt : '',
            })
        }

        const { plan, bytes } = await captureAgentArchive(conn, engineAgentId, selection.exclude)

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

export async function removeCapturedAgent(supabase: SupabaseClient<Database>, slug: string, agentKey: string): Promise<void> {
    const { data: template } = await selectSingle(supabase, 'templates', ['id', 'slug', 'agents', 'agent_archives'] as const, { slug })
    if (!template) throw new AppError('templateSlugNotFound', { slug })

    const agents = agentsFromRow.parse(template.agents).filter(agent => agent.key !== agentKey)
    const archives = archivesFromRow.parse(template.agent_archives)
    const removed = archives.filter(entry => entry.agentKey === agentKey)

    await removePrivateFiles(supabase, AGENT_ARCHIVE_BUCKET, removed.map(entry => entry.path)).catch(() => {})

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
