import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor } from '@/app/api/_auth/access'
import type { Database } from '@/app/api/database.types'
import { deriveUniqueHandles, importAgent } from '@/app/api/_services/agent.service'
import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import { downloadPrivateFile } from '@/lib/storage/private'
import { staleImportError } from '@/lib/agents/capture-archive'
import { AppError } from '@/lib/i18n/action-error'
import { agentsFromRow } from './document'
import { AGENT_ARCHIVE_BUCKET, archiveAgentNames, archivesFromRow } from './archives'
import { AGENT_SPAN, containerContainsTile } from '@/lib/board/iso'
import type { GridPosition } from '@/lib/board/types'

// Narrower than the shared `isMissingRoute`: only the import route being absent means the whole
// batch is doomed, a 404 on anything else is about this one archive.
function isMissingImportRoute(err: unknown): boolean {
    return err instanceof Error && /\/agents\/import failed: 404/.test(err.message)
}

// `inactive` counts the agents that landed switched off because the plan had no slot left for
// them. They are installed and complete, they just will not run until a slot frees up.
// `alreadyInstalled`: the workspace had this template's coworkers already, and `agentIds` are those.
export type TemplateInstallOutcome = { imported: number; inactive: number; agentIds: string[]; failed: { name: string; error: string }[]; warnings: string[]; alreadyInstalled: boolean }

// The anchors come from the client, so they are treated as a preference rather than a fact: one
// that does not fit inside the target space is dropped, and that agent falls back to the free cell
// the server picks for it.
async function anchorsInsideSpace(supabase: SupabaseClient<Database>, spaceId: string, positions: GridPosition[] | undefined): Promise<(GridPosition | undefined)[]> {
    if (!positions?.length) return []
    const { data: space } = await selectSingle(supabase, 'spaces', ['col_start', 'row_start', 'col_end', 'row_end'] as const, { id: spaceId })
    if (!space) return []

    return positions.map(p => (containerContainsTile(space, p, AGENT_SPAN) ? p : undefined))
}

// The mirror of capture.ts: capture archives a folder, install unpacks it back into a space.
// Nothing here reads the tarball. The engine is the only side that opens it, so the connectors an
// imported agent still needs are the ones its own registry already declares as needing auth, and
// the Services tab renders them with nothing new to build.
export async function installTemplate(supabase: SupabaseClient<Database>, slug: string, target: { workspaceId: number; spaceId: string; actor: Actor; positions?: GridPosition[]; again?: boolean }): Promise<TemplateInstallOutcome> {
    const { data: template } = await selectSingle(supabase, 'templates', ['id', 'title', 'agents', 'agent_archives'] as const, { slug })
    if (!template) throw new AppError('templateSlugNotFound', { slug })

    // A replayed install (the foreman calling twice, a retry after checkout, a second tab) would land
    // a second team with the same names, each asking to be set up from scratch, so the workspace
    // gets back the coworkers it already has. Only the user's explicit "Install again" sets `again`.
    if (!target.again) {
        const { data: installed } = await selectMany(supabase, 'agents', ['id'] as const, { workspace_id: target.workspaceId, template_id: template.id }, { column: 'created_at' })
        if (installed?.length) return { imported: 0, inactive: 0, agentIds: installed.map(agent => agent.id), failed: [], warnings: [], alreadyInstalled: true }
    }

    const agents = agentsFromRow.parse(template.agents)
    const archives = archivesFromRow.parse(template.agent_archives)
    if (archives.length === 0) throw new AppError('templateHasNoCoworker', { title: template.title })

    // Named after the editorial entry when there is one, so an admin's rename of a captured agent
    // is what the importer sees.
    const names = archiveAgentNames(archives, agents)
    const handles = await deriveUniqueHandles(supabase, target.workspaceId, names)
    const anchors = await anchorsInsideSpace(supabase, target.spaceId, target.positions)

    const failed: TemplateInstallOutcome['failed'] = []
    const warnings: string[] = []
    const agentIds: string[] = []
    let imported = 0
    let inactive = 0

    for (const [index, archive] of archives.entries()) {
        try {
            const blob = await downloadPrivateFile(supabase, AGENT_ARCHIVE_BUCKET, archive.path)
            // The template id rides along so a revoked purchase can name the agents it installed.
            const { agent, imported: result } = await importAgent({
                archive: blob,
                name: names[index],
                handle: handles[index],
                workspaceId: target.workspaceId,
                spaceId: target.spaceId,
                actor: target.actor,
                position: anchors[index],
                templateId: template.id,
            })
            imported += 1
            if (agent.disabled_at) inactive += 1
            agentIds.push(agent.id)
            // The engine is the only side that opens the tarball, so a refused entry is the one
            // thing about the copy the caller cannot see for itself.
            if (result.skippedPaths.length > 0) warnings.push(`"${names[index]}": ${result.skippedPaths.length} file(s) in the archive were refused (${result.skippedPaths.slice(0, 3).join(', ')}).`)
            // The copy answers to webhook addresses of its own, and nothing else will say so: the
            // template author's URLs stayed on their box.
            if (result.triggers.length > 0) {
                warnings.push(`"${names[index]}": ${result.triggers.length} webhook(s) were created with a new URL each (${result.triggers.join(', ')}). Read them in the coworker panel and point your services at them.`)
            }
        } catch (err) {
            // An engine too old to answer this route will fail on every agent, so it is worth
            // stopping on. Anything else is about this one archive: there is no transaction
            // between Supabase and the engine, and an agent that already landed is real and
            // visible on the grid, so the rest of the batch carries on and reports what failed.
            if (isMissingImportRoute(err)) throw staleImportError()
            failed.push({ name: names[index], error: err instanceof Error ? err.message : 'Unknown error' })
        }
    }

    if (imported === 0) throw new Error(failed[0]?.error ?? `"${template.title}" imported no coworker.`)

    return { imported, inactive, agentIds, failed, warnings, alreadyInstalled: false }
}
