import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrainPage } from '@rerun/contracts'

import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import type { CompanyFindingsRow } from '@/lib/company/explore/findings'
import { listBrainPages, readBrainPage } from '@/lib/engine/client'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { answersEvidence, brainEvidence, buildEvidence, findingsEvidence } from './evidence'
import type { CompanyDossier } from './types'

const BRAIN_PAGES_MAX = 40

function asObject<T>(value: unknown): T | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
}

type BrainRead = { pages: BrainPage[]; warning: string | null }

async function readBrain(workspaceId: number): Promise<BrainRead> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return { pages: [], warning: 'Ce workspace n’a pas de machine : pas de brain, le dossier vient de Supabase seul.' }

    try {
        const summaries = (await listBrainPages(engine.conn)).slice(0, BRAIN_PAGES_MAX)
        const pages = await Promise.all(summaries.map(async summary => (await readBrainPage(engine.conn, summary.slug)).page))
        return { pages, warning: pages.length ? null : 'Le brain de ce workspace est vide.' }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { pages: [], warning: `Brain injoignable (${message}) : le dossier vient de Supabase seul.` }
    }
}

export async function loadCompanyDossier(supabase: SupabaseClient<Database>, workspaceId: number): Promise<CompanyDossier> {
    const [workspace, onboarding, agents, brain] = await Promise.all([selectMaybeSingle(supabase, 'workspaces', ['id', 'name'] as const, { id: workspaceId }), selectMaybeSingle(supabase, 'workspace_onboarding', ['answers', 'company_findings'] as const, { workspace_id: workspaceId }), selectMany(supabase, 'agents', ['name', 'description'] as const, { workspace_id: workspaceId }, { column: 'created_at' }), readBrain(workspaceId)])
    if (!workspace.data) throw new Error(`Workspace ${workspaceId} introuvable`)

    const answers = asObject<ForemanAnswers>(onboarding.data?.answers) ?? {}
    const findings = asObject<CompanyFindingsRow>(onboarding.data?.company_findings)

    const evidence = buildEvidence(brainEvidence(brain.pages), answersEvidence(answers, { withProfile: brain.pages.length === 0 }), findingsEvidence(findings))

    return {
        workspaceId,
        companyName: answers.company_name?.trim() || workspace.data.name,
        evidence,
        existingAgents: (agents.data ?? []).map(agent => ({ name: agent.name, description: agent.description ?? '' })),
        warnings: [brain.warning, findings ? null : 'Aucune exploration d’entreprise enregistrée pour ce workspace.'].filter((warning): warning is string => Boolean(warning)),
    }
}
