import { coworkerLanguageFor } from '@/app/api/_services/coworker-language.service'
import { languageName } from '@rerun/i18n'
import { rewindPayloadSchema, type RewindPayload } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/app/api/database.types'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { getAgentRewind } from './engine'
import { selectAll, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { loadServiceCatalog } from '@/lib/templates/catalog'
import { writeHighlights } from './highlights'
import { connectorSlugsOf, mergeRewind, type RewindAgentInput, type ReportedAgent } from './merge'
import { weekBefore, type RewindWeek } from './week'

const AGENT_TIMEOUT_MS = 20_000
const AGENT_CONCURRENCY = 4

type Client = SupabaseClient<Database>

export type RewindBuildResult = { status: 'stored'; runs: number } | { status: 'skipped'; reason: string }

async function mapPooled<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await run(items[index])
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

async function loadAgents(supabase: Client, workspaceId: number, week: RewindWeek): Promise<RewindAgentInput[]> {
    const [{ data: agents }, { data: spaces }, engine] = await Promise.all([
        selectAll(supabase, 'agents', ['id', 'name', 'engine_agent_id', 'space_id'] as const, { workspace_id: workspaceId, engine_agent_id: { notNull: true } }),
        selectAll(supabase, 'spaces', ['id', 'name'] as const, { workspace_id: workspaceId }),
        findWorkspaceEngine(workspaceId),
    ])
    const spacesById = new Map((spaces ?? []).map(space => [space.id, space]))

    return mapPooled(agents ?? [], AGENT_CONCURRENCY, async agent => {
        const input = { agentId: agent.id, engineAgentId: agent.engine_agent_id!, spaceId: agent.space_id, name: agent.name, spaceName: spacesById.get(agent.space_id)?.name ?? null }
        if (!engine) return { ...input, report: null }
        const report = await getAgentRewind(engine.conn, input.engineAgentId, week.from, week.to, AbortSignal.timeout(AGENT_TIMEOUT_MS)).catch(() => null)
        return { ...input, report }
    })
}

async function loadPreviousTotals(supabase: Client, workspaceId: number, week: RewindWeek): Promise<RewindPayload['previous']> {
    const { data } = await selectMaybeSingle(supabase, 'workspace_rewinds', ['payload'] as const, { workspace_id: workspaceId, week_start: weekBefore(week).weekStart })
    const parsed = rewindPayloadSchema.safeParse(data?.payload)
    return parsed.success ? { runs: parsed.data.totals.runs, workedMs: parsed.data.totals.workedMs } : null
}

export async function buildWorkspaceRewind(supabase: Client, workspaceId: number, week: RewindWeek): Promise<RewindBuildResult> {
    const agents = await loadAgents(supabase, workspaceId, week)
    if (agents.length === 0) return { status: 'skipped', reason: 'no coworkers' }

    const reported = agents.filter((agent): agent is ReportedAgent => agent.report !== null)
    if (reported.length === 0) return { status: 'skipped', reason: 'no Box reachable' }
    // A quiet week gets no story: opening one by itself to say "nothing happened" is noise.
    if (reported.every(agent => agent.report.runs.total === 0)) return { status: 'skipped', reason: 'no runs' }

    const language = await coworkerLanguageFor(supabase, workspaceId)
    const [previous, highlights, catalog] = await Promise.all([
        loadPreviousTotals(supabase, workspaceId, week),
        writeHighlights(reported, language ? languageName(language) : undefined),
        loadServiceCatalog(supabase, connectorSlugsOf(reported)),
    ])
    const payload = mergeRewind({ week, agents, catalog, previous, highlights })

    const { error } = await supabase
        .from('workspace_rewinds')
        .upsert<Database['public']['Tables']['workspace_rewinds']['Insert']>(
            { workspace_id: workspaceId, week_start: week.weekStart, payload: payload as unknown as Json },
            { onConflict: 'workspace_id,week_start' }
        )
    if (error) throw new Error(`storing the Rewind of workspace ${workspaceId} failed: ${error.message}`)
    return { status: 'stored', runs: payload.totals.runs }
}
