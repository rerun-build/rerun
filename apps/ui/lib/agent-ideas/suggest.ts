import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { workspaceBrand } from '@/lib/brand/workspace'
import type { CollectorCost } from '@/lib/company/explore/types'
import { selectAll } from '@/supabase/supabase-helpers'
import { design } from './design'
import { diagnose } from './diagnose'
import { loadCompanyDossier } from './dossier'
import { groundCandidates } from './ground'
import { judgeCandidates } from './judge'
import { selectIdeas } from './select'
import type { CatalogApp, Selection, StepData, SuggestEvent, SuggestStep } from './types'

// Under this the models have nothing to tell this company from the next one, and what comes out is
// the generic list the whole pipeline is there to avoid.
const MIN_EVIDENCE = 8

const CATALOG_COLUMNS = ['slug', 'name', 'category', 'summary', 'icon'] as const

async function loadCatalog(supabase: SupabaseClient<Database>): Promise<CatalogApp[]> {
    const { data, error } = await selectAll(supabase, 'services', CATALOG_COLUMNS, { enabled: true }, { column: 'slug' })
    if (error) throw new Error(error.message)
    return data ?? []
}

type StepResult<K extends SuggestStep> = { data: StepData[K]; highlights: string[]; cost?: CollectorCost }

// Agents made to measure for one workspace, from everything we know about its company. Each step
// reports as it lands so the lab can show where an idea came from and where it died; a step that
// fails ends the run there, since every later one reads its output.
export async function suggestAgents(supabase: SupabaseClient<Database>, workspaceId: number, emit: (event: SuggestEvent) => void): Promise<Selection | null> {
    const startedAt = Date.now()

    async function step<K extends SuggestStep>(id: K, run: () => Promise<StepResult<K>> | StepResult<K>): Promise<StepData[K]> {
        const stepStartedAt = Date.now()
        emit({ type: 'running', step: id })
        try {
            const output = await run()
            emit({ type: 'done', step: id, durationMs: Date.now() - stepStartedAt, output } as SuggestEvent)
            return output.data
        } catch (error) {
            emit({ type: 'error', step: id, durationMs: Date.now() - stepStartedAt, error: error instanceof Error ? error.message : String(error) })
            throw error
        }
    }

    try {
        const dossier = await step('dossier', async () => {
            const data = await loadCompanyDossier(supabase, workspaceId)
            const sources = new Set(data.evidence.map(item => item.source.split(':')[0]))
            return { data, highlights: [`${data.evidence.length} preuves (${[...sources].join(', ') || 'aucune source'})`, `${data.existingAgents.length} agent(s) existant(s)`, ...data.warnings] }
        })

        const opportunities = await step('diagnose', async () => {
            if (dossier.evidence.length < MIN_EVIDENCE) throw new Error(`Pas assez de matière sur cette entreprise : ${dossier.evidence.length} preuves, il en faut ${MIN_EVIDENCE}.`)
            const { opportunities: data, cost } = await diagnose(dossier)
            return { data, cost, highlights: data.map(opportunity => `[${opportunity.lens}] ${opportunity.job}`) }
        })

        const catalog = await loadCatalog(supabase)
        const candidates = await step('design', async () => {
            const { candidates: data, cost } = await design(dossier, opportunities, catalog, await workspaceBrand(workspaceId))
            return { data, cost, highlights: data.map(candidate => `${candidate.name} : ${candidate.role}`) }
        })

        const { grounded } = await step('ground', () => {
            const data = groundCandidates(candidates, dossier, catalog)
            const missing = data.grounded.reduce((sum, candidate) => sum + candidate.missingApps.length, 0)
            return { data, highlights: [`${data.grounded.length} candidats ancrés`, `${data.dropped.length} écarté(s)`, `${missing} app(s) hors catalogue`, ...data.dropped.map(dropped => `${dropped.name} : ${dropped.reason}`)] }
        })

        const judged = await step('judge', async () => {
            const { judged: data, usd } = await judgeCandidates(grounded, dossier)
            return { data, cost: { usd }, highlights: [`${data.length} candidats notés sur 5 critères`] }
        })

        return await step('select', () => {
            const data = selectIdeas(judged)
            return { data, highlights: [`${data.kept.length} retenue(s)`, `${data.rejected.length} rejetée(s)`, ...data.kept.map(idea => `${idea.total.toFixed(2)} · ${idea.name}`)] }
        })
    } catch {
        return null
    } finally {
        emit({ type: 'end', durationMs: Date.now() - startedAt })
    }
}
