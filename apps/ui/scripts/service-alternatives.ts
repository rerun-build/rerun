import { writeFileSync } from 'node:fs'
import type { Database } from '@/app/api/database.types'
import { ALTERNATIVE_THRESHOLD, MANUAL_ALTERNATIVE_MODEL } from '../lib/services/alternatives'
import { createServiceRoleClient } from '../supabase/serviceRole'
import { selectAll, selectMany } from '../supabase/supabase-helpers'

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
const MODEL = 'typesafe/jev-1.13'
const STORED_FLOOR = 0.3
const PARALLEL_SERVICES = 6
const MAX_ATTEMPTS = 4
const DESCRIPTION_CHARS = 400
const QUESTIONS_PER_REQUEST = 50

const RELATION_LEVELS = [
    'Different job: someone who uses `service` could not use `candidate` to do what they use `service` for. This includes a product from the same company that does another job (a spreadsheet is not a document editor) and generic automation or integration platforms that connect many apps.',
    'Partial overlap: `candidate` covers one of the main features of `service`, but a user could not replace `service` with it for its core job.',
    'Same job: `candidate` is a direct replacement for `service`. A user could switch from `service` to `candidate` and keep doing the same core job.',
]

type CatalogService = { slug: string; name: string; category: string; summary: string; description: string }

type ScoreAnswer = { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
type DecisionsResponse = { answers: Record<string, ScoreAnswer>; usage: { input_tokens: number; cost: number } }

type RatedCandidate = { slug: string; sameJob: number; partial: number; score: number; confidence: number }
type ServiceAlternativeInsert = Database['public']['Tables']['service_alternatives']['Insert']
type ServiceReport = { slug: string; alternatives: RatedCandidate[]; rejected: RatedCandidate[]; cost: number; tokens: number }

async function loadCatalog(): Promise<CatalogService[]> {
    const supabase = createServiceRoleClient()
    const { data, error } = await selectAll(supabase, 'services', ['slug', 'name', 'category', 'summary', 'manifest'] as const, { enabled: true }, { column: 'slug' })
    if (error) throw error
    return data.map(row => ({
        slug: row.slug,
        name: row.name,
        category: row.category,
        summary: row.summary,
        description: ((row.manifest as { description?: string }).description ?? '').slice(0, DESCRIPTION_CHARS),
    }))
}

function describe(service: CatalogService) {
    return { name: service.name, category: service.category, summary: service.summary, description: service.description }
}

async function decide(state: unknown, questions: Record<string, unknown>, attempt = 1): Promise<DecisionsResponse> {
    const response = await fetch(DECISIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state, questions }),
    })
    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
        return decide(state, questions, attempt + 1)
    }
    if (!response.ok) throw new Error(`Jev ${response.status}: ${await response.text()}`)
    return (await response.json()) as DecisionsResponse
}

async function rateCandidates(service: CatalogService, candidates: CatalogService[]): Promise<DecisionsResponse> {
    const batches: CatalogService[][] = []
    for (let i = 0; i < candidates.length; i += QUESTIONS_PER_REQUEST) batches.push(candidates.slice(i, i + QUESTIONS_PER_REQUEST))
    const results = await Promise.all(batches.map(batch => rateBatch(service, batch)))
    return {
        answers: Object.assign({}, ...results.map(result => result.answers)),
        usage: { input_tokens: results.reduce((sum, result) => sum + result.usage.input_tokens, 0), cost: results.reduce((sum, result) => sum + result.usage.cost, 0) },
    }
}

async function rateBatch(service: CatalogService, candidates: CatalogService[]) {
    const questions = Object.fromEntries(
        candidates.map(candidate => [
            candidate.slug,
            {
                type: 'score',
                instructions: { question: 'How does `candidate` relate to `service`, the app described in the state?', service: service.name, candidate: describe(candidate) },
                criteria: RELATION_LEVELS,
            },
        ]),
    )
    return decide(describe(service), questions)
}

async function mapService(service: CatalogService, catalog: CatalogService[]): Promise<ServiceReport> {
    const others = catalog.filter(other => other.slug !== service.slug)
    const rating = await rateCandidates(service, others)
    const rated: RatedCandidate[] = others
        .map(other => {
            const answer = rating.answers[other.slug]
            return { slug: other.slug, sameJob: answer.probabilities['2'], partial: answer.probabilities['1'], score: answer.score, confidence: answer.confidence }
        })
        .sort((a, b) => b.sameJob - a.sameJob)

    return {
        slug: service.slug,
        alternatives: rated.filter(candidate => candidate.sameJob >= ALTERNATIVE_THRESHOLD),
        rejected: rated.filter(candidate => candidate.sameJob < ALTERNATIVE_THRESHOLD),
        cost: rating.usage.cost,
        tokens: rating.usage.input_tokens,
    }
}

function formatCandidate(candidate: RatedCandidate) {
    return `${candidate.slug} ${candidate.sameJob.toFixed(2)}`
}

async function writeAlternatives(report: ServiceReport) {
    const supabase = createServiceRoleClient()
    const { data: manualRows, error: manualError } = await selectMany(supabase, 'service_alternatives', ['alternative_slug'] as const, { service_slug: report.slug, model: MANUAL_ALTERNATIVE_MODEL })
    if (manualError) throw manualError
    const manualSlugs = new Set((manualRows ?? []).map(row => row.alternative_slug))
    const { error: deleteError } = await supabase.from('service_alternatives').delete().eq('service_slug', report.slug).neq('model', MANUAL_ALTERNATIVE_MODEL)
    if (deleteError) throw deleteError
    const rows = [...report.alternatives, ...report.rejected]
        .filter(candidate => candidate.sameJob >= STORED_FLOOR && !manualSlugs.has(candidate.slug))
        .map(
            (candidate): ServiceAlternativeInsert => ({
                service_slug: report.slug,
                alternative_slug: candidate.slug,
                probability: candidate.sameJob,
                confidence: candidate.confidence,
                model: MODEL,
            }),
        )
    if (!rows.length) return
    const { error } = await supabase.from('service_alternatives').insert<ServiceAlternativeInsert>(rows)
    if (error) throw error
}

async function run(outPath: string, slugs: string[], write: boolean) {
    const catalog = await loadCatalog()
    const targets = slugs.length ? catalog.filter(service => slugs.includes(service.slug)) : catalog
    const reports: ServiceReport[] = []
    for (let i = 0; i < targets.length; i += PARALLEL_SERVICES) {
        const wave = await Promise.all(targets.slice(i, i + PARALLEL_SERVICES).map(service => mapService(service, catalog)))
        for (const report of wave) {
            if (write) await writeAlternatives(report)
            reports.push(report)
            console.log(`${report.slug}: ${report.alternatives.map(formatCandidate).join(', ') || '(none)'}`)
        }
    }
    writeFileSync(outPath, JSON.stringify(reports, null, 2))
    const cost = reports.reduce((sum, report) => sum + report.cost, 0)
    console.log(`\n${reports.length} services, $${cost.toFixed(4)}, report in ${outPath}${write ? ', written to service_alternatives' : ' (dry run)'}`)
}

async function main() {
    const [command, outPath, ...rest] = process.argv.slice(2)
    const slugs = rest.filter(arg => !arg.startsWith('--'))
    if (command === 'run' && outPath) return run(outPath, slugs, rest.includes('--write'))
    console.log('Usage: service-alternatives.ts run <out.json> [slug...] [--write]')
    process.exit(1)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
