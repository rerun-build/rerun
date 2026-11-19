import { realEmail } from '@/lib/auth/placeholder-email'
import { queue, task } from '@trigger.dev/sdk/v3'
import { taskLogger as logger } from '@moldwright/cloud/tasks'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/app/api/database.types'
import { buildSeedPages, seedPagesOutline } from '@/lib/brain/seed-pages'
import { COLLECTOR_IDS } from '@/lib/company/explore/catalog'
import type { CatalogFindings } from '@/lib/company/explore/catalog-collector'
import { createDiscoveryTranslator, serviceIconLookup } from '@/lib/company/explore/discoveries.server'
import { exploreCompany } from '@/lib/company/explore/explore'
import { applyToRow, type CompanyFindingsRow, type DiscoveryEvent } from '@/lib/company/explore/findings'
import type { SynthesisFindings } from '@/lib/company/explore/synthesize'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

export type ExploreCompanyPayload = { workspaceId: number; url: string }

export type ExploredCompany = SynthesisFindings & { catalog?: CatalogFindings | null }

const companyExploreQueue = queue({ name: 'company-explore', concurrencyLimit: 1 })

type Signup = { personName: string | null; email: string | null }

export async function readAnswers(supabase: SupabaseClient<Database>, workspaceId: number): Promise<ForemanAnswers> {
    const { data } = await selectMaybeSingle(supabase, 'workspace_onboarding', ['answers'] as const, { workspace_id: workspaceId })
    const value = data?.answers
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ForemanAnswers) : {}
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string {
    const value = metadata?.[key]
    return typeof value === 'string' ? value.trim() : ''
}

export async function readSignup(supabase: SupabaseClient<Database>, workspaceId: number): Promise<Signup> {
    const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId }, { column: 'created_at' }, 1)
    const owner = members?.[0]
    if (!owner) return { personName: null, email: null }

    const { data } = await supabase.auth.admin.getUserById(owner.user_id)
    const user = data.user
    if (!user || user.is_anonymous) return { personName: null, email: null }

    const metadata = user.user_metadata
    const personName = metadataString(metadata, 'full_name') || metadataString(metadata, 'name') || metadataString(metadata, 'first_name')
    return { personName: personName || null, email: realEmail(user.email)?.trim() || null }
}

export async function writeCompanyFindings(supabase: SupabaseClient<Database>, workspaceId: number, row: CompanyFindingsRow): Promise<void> {
    const { error } = await supabase
        .from('workspace_onboarding')
        .upsert<Database['public']['Tables']['workspace_onboarding']['Insert']>({ workspace_id: workspaceId, company_findings: row as unknown as Json }, { onConflict: 'workspace_id' })
    if (error) logger.warn('company explore: findings not written', { workspaceId, error: error.message })
}

export const exploreCompanyTask = task({
    id: 'explore-company',
    queue: companyExploreQueue,
    maxDuration: 900,
    retry: { maxAttempts: 1 },
    run: (payload: ExploreCompanyPayload) => exploreCompanyRun(payload),
})

export async function exploreCompanyRun({ workspaceId, url }: ExploreCompanyPayload): Promise<ExploredCompany | null> {
    const supabase = createServiceRoleClient()
    const domain = new URL(url).hostname
    let row: CompanyFindingsRow = { url, status: 'running', pending: [], findings: [] }
    await writeCompanyFindings(supabase, workspaceId, row)

    let writing = Promise.resolve()
    const record = (translate: () => Promise<DiscoveryEvent[]>) => {
        writing = writing.then(async () => {
            const events = await translate()
            if (!events.length) return
            row = events.reduce(applyToRow, row)
            await writeCompanyFindings(supabase, workspaceId, row)
        })
    }

    try {
        const [answers, signup] = await Promise.all([readAnswers(supabase, workspaceId), readSignup(supabase, workspaceId)])
        const translator = createDiscoveryTranslator({ domain, icons: serviceIconLookup(supabase) })
        if (answers.company_name) record(() => translator.fromProfile({ name: answers.company_name, description: answers.company_description, audience: answers.company_audience }))

        let synthesis = null as SynthesisFindings | null
        let catalog = null as CatalogFindings | null
        await exploreCompany({ url, domain, personName: signup.personName, email: signup.email, linkedinUrl: null }, new Set(COLLECTOR_IDS), event => {
            if (event.type === 'done' && event.id === 'synthesis') synthesis = event.output.data as SynthesisFindings
            else if (event.type === 'done' && event.id === 'catalog') catalog = event.output.data as CatalogFindings
            else if (event.type === 'error') logger.warn('company explore: collector failed', { collector: event.id, error: event.error })
            else if (event.type === 'skipped') logger.log('company explore: collector skipped', { collector: event.id, reason: event.reason })
            else if (event.type === 'end') logger.log('company explore: done', { durationMs: event.durationMs })
            record(() => translator.fromExplore(event))
        })

        if (synthesis) {
            const pages = buildSeedPages({ card: synthesis.card, brief: synthesis.brief, foreman: answers.foreman, catalog })
            if (pages.length) record(async () => [{ type: 'found', source: 'synthesis', findings: [{ kind: 'brain', source: 'synthesis', pages: pages.length, ...seedPagesOutline(pages) }] }])
        }
        record(async () => [{ type: 'end' }])
        await writing
        return synthesis ? { ...synthesis, catalog } : null
    } catch (error) {
        logger.error('company explore: failed', { workspaceId, url, error: error instanceof Error ? error.message : String(error) })
        await writing.catch(() => {})
        await writeCompanyFindings(supabase, workspaceId, { ...row, status: 'failed', pending: [] })
        return null
    }
}
