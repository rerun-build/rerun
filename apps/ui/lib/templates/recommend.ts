import { generateObject } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TemplateCategory } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import type { OnboardingAnswers } from '@/app/actions/onboarding'
import { hasOpenRouterKey, openrouter } from '@/lib/ai/openrouter'
import { selectAll, type Filters } from '@/supabase/supabase-helpers'
import { archiveAgentNames, archivesFromRow } from './archives'
import { agentsFromRow, connectorsFromRow } from './document'
import { templateCardStamp, templateEmailCardUrl } from './email-card'
import { VOICE, clean } from './voice'

const RECOMMEND_MODEL = process.env.RERUN_RECOMMEND_MODEL ?? 'anthropic/claude-haiku-4.5'

const LINE_LIMIT = 90
const SHORTLIST_SIZE = 8
const PER_CATEGORY_CAP = 2
const MAX_PICKS = 3
const MIN_PICKS = 2
const MAX_CONNECTORS = 4

const RECOMMEND_FILTERS: Filters<'templates'> = { status: ['published'], show_in_library: true }

const RECOMMEND_COLUMNS = ['slug', 'title', 'tagline', 'category', 'featured', 'published_at', 'connectors', 'agents', 'agent_archives', 'setup_minutes', 'pricing_model', 'updated_at', 'card_image_dark_url'] as const

export type TemplateCandidate = {
    slug: string
    title: string
    tagline: string
    category: string
    featured: boolean
    publishedAt: Date | null
    connectorSlugs: string[]
    connectorNames: string[]
    setupMinutes: number
    free: boolean
    cardStamp: string
}

export type TemplateRecommendation = {
    slug: string
    title: string
    line: string
    setupMinutes: number
    url: string
    imageUrl: string
}

export type RecommendContext = {
    tools: string[]
    industry: TemplateCategory | null
    now: Date
}

const WEIGHTS = {
    connectorTop: 30,
    connectorDecay: 4,
    connectorFloor: 12,
    connectorCap: 60,
    category: 25,
    featured: 20,
    fresh90: 8,
    fresh365: 4,
    free: 6,
    quickSetup: 4,
    missingConnector: -4,
    missingFloor: -16,
} as const

const SOLID_SCORE = 25
const DAY = 24 * 60 * 60_000

export function toCandidate(row: Record<string, unknown>): TemplateCandidate | null {
    const archives = archivesFromRow.parse(row.agent_archives)
    const agents = agentsFromRow.parse(row.agents)
    if (archiveAgentNames(archives, agents).length === 0) return null

    const tagline = typeof row.tagline === 'string' ? row.tagline.trim() : ''
    if (!tagline) return null

    const connectors = connectorsFromRow.parse(row.connectors)
    if (connectors.length > MAX_CONNECTORS) return null

    const publishedAt = typeof row.published_at === 'string' ? new Date(row.published_at) : null

    return {
        slug: String(row.slug),
        title: String(row.title),
        tagline,
        category: String(row.category ?? 'other'),
        featured: row.featured === true,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        connectorSlugs: connectors.map(connector => connector.slug),
        connectorNames: connectors.map(connector => connector.name),
        setupMinutes: typeof row.setup_minutes === 'number' ? row.setup_minutes : 5,
        free: row.pricing_model === 'free',
        cardStamp: templateCardStamp({
            updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
            card_image_dark_url: typeof row.card_image_dark_url === 'string' ? row.card_image_dark_url : null,
        }),
    }
}

export function scoreCandidate(candidate: TemplateCandidate, context: RecommendContext): number {
    const matched = candidate.connectorSlugs.filter(slug => context.tools.includes(slug))
    const overlap = matched.reduce((total, slug) => total + Math.max(WEIGHTS.connectorTop - WEIGHTS.connectorDecay * context.tools.indexOf(slug), WEIGHTS.connectorFloor), 0)

    const age = candidate.publishedAt ? context.now.getTime() - candidate.publishedAt.getTime() : Number.POSITIVE_INFINITY
    const freshness = age <= 90 * DAY ? WEIGHTS.fresh90 : age <= 365 * DAY ? WEIGHTS.fresh365 : 0

    return (
        Math.min(WEIGHTS.connectorCap, overlap) +
        (context.industry && context.industry !== 'other' && candidate.category === context.industry ? WEIGHTS.category : 0) +
        (candidate.featured ? WEIGHTS.featured : 0) +
        freshness +
        (candidate.free ? WEIGHTS.free : 0) +
        (candidate.setupMinutes <= 15 ? WEIGHTS.quickSetup : 0) +
        Math.max(WEIGHTS.missingFloor, WEIGHTS.missingConnector * (candidate.connectorSlugs.length - matched.length))
    )
}

function isSolid(candidate: TemplateCandidate, score: number, context: RecommendContext): boolean {
    if (score < SOLID_SCORE) return false
    const matches = candidate.connectorSlugs.some(slug => context.tools.includes(slug))
    return matches || candidate.featured || (context.industry !== null && context.industry !== 'other' && candidate.category === context.industry)
}

export function shortlistTemplates(candidates: TemplateCandidate[], context: RecommendContext): TemplateCandidate[] {
    const scored = candidates
        .map(candidate => ({ candidate, score: scoreCandidate(candidate, context) }))
        .filter(entry => isSolid(entry.candidate, entry.score, context))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            if (a.candidate.featured !== b.candidate.featured) return a.candidate.featured ? -1 : 1
            const published = (b.candidate.publishedAt?.getTime() ?? 0) - (a.candidate.publishedAt?.getTime() ?? 0)
            return published !== 0 ? published : a.candidate.slug.localeCompare(b.candidate.slug)
        })

    const perCategory = new Map<string, number>()
    const shortlist: TemplateCandidate[] = []
    for (const { candidate } of scored) {
        const used = perCategory.get(candidate.category) ?? 0
        if (used >= PER_CATEGORY_CAP) continue
        perCategory.set(candidate.category, used + 1)
        shortlist.push(candidate)
        if (shortlist.length === SHORTLIST_SIZE) break
    }
    return shortlist
}

export function recommendContext(answers: OnboardingAnswers | null, now: Date): RecommendContext {
    return {
        tools: Array.isArray(answers?.tools) ? answers.tools : [],
        industry: answers?.industry ?? null,
        now,
    }
}

export async function loadRecommendCandidates(supabase: SupabaseClient<Database>): Promise<TemplateCandidate[]> {
    const { data, error } = await selectAll(supabase, 'templates', RECOMMEND_COLUMNS, RECOMMEND_FILTERS, { column: 'published_at', ascending: false })
    if (error || !data) return []
    return data.map(row => toCandidate(row as unknown as Record<string, unknown>)).filter((candidate): candidate is TemplateCandidate => candidate !== null)
}

function templateUrl(appUrl: string, slug: string): string {
    return `${appUrl}/?template=${encodeURIComponent(slug)}`
}

function fallback(shortlist: TemplateCandidate[], appUrl: string): TemplateRecommendation[] {
    return shortlist.slice(0, MAX_PICKS).map(candidate => ({
        slug: candidate.slug,
        title: candidate.title,
        line: clean(candidate.tagline, LINE_LIMIT),
        setupMinutes: candidate.setupMinutes,
        url: templateUrl(appUrl, candidate.slug),
        imageUrl: templateEmailCardUrl(appUrl, candidate.slug, candidate.cardStamp),
    }))
}

const ROLE = `You are picking the two or three coworker setups to put in front of one company, in an email they did not ask for.
The shortlist is already filtered and already ranked. Your job is to pick from it and to say what each pick delivers for this company.

- Pick 2 or 3, in the order you want them read, best first.
- Only pick from the shortlist, and copy each slug exactly.
- Drop a candidate rather than stretch it: two strong picks beat three where the third is a guess.
- Each line says what the setup produces for this company, not what the template is in general.
- Never claim something the shortlist entry does not state.`

function describeContext(answers: OnboardingAnswers | null, shortlist: TemplateCandidate[], context: RecommendContext): string {
    const company = [
        answers?.company_name ? `Name: ${answers.company_name}` : null,
        answers?.company_description ? `What they do: ${answers.company_description}` : null,
        answers?.company_offering ? `What they sell: ${answers.company_offering}` : null,
        answers?.company_audience ? `Who they sell to: ${answers.company_audience}` : null,
        context.industry ? `Industry: ${context.industry}` : null,
    ].filter(Boolean)

    const entries = shortlist.map((candidate, index) => {
        const known = candidate.connectorSlugs.filter(slug => context.tools.includes(slug))
        const needs = candidate.connectorNames.length ? `Needs: ${candidate.connectorNames.join(', ')}${known.length ? ` (${known.length} already in their stack)` : ''}` : 'Needs: nothing to connect'
        return [`${index + 1}. ${candidate.slug}`, `   Title: ${candidate.title}`, `   Does: ${candidate.tagline}`, `   Category: ${candidate.category}`, `   ${needs}`, `   Setup: ${candidate.setupMinutes} min, ${candidate.free ? 'free' : 'paid'}`].join('\n')
    })

    return [
        company.length ? `Company\n${company.join('\n')}` : 'Company\nNothing was captured about them.',
        context.tools.length ? `\nTools they said they use, in the order they picked them: ${context.tools.join(', ')}` : '',
        `\nShortlist\n${entries.join('\n')}`,
    ].join('\n')
}

export function resolvePicks(shortlist: TemplateCandidate[], picks: { slug: string; line: string }[], appUrl: string): TemplateRecommendation[] {
    const bySlug = new Map(shortlist.map(candidate => [candidate.slug, candidate]))
    const seen = new Set<string>()
    const resolved: TemplateRecommendation[] = []

    for (const pick of picks) {
        const candidate = bySlug.get(pick.slug)
        if (!candidate || seen.has(pick.slug)) continue
        seen.add(pick.slug)
        resolved.push({
            slug: candidate.slug,
            title: candidate.title,
            line: clean(pick.line, LINE_LIMIT) || clean(candidate.tagline, LINE_LIMIT),
            setupMinutes: candidate.setupMinutes,
            url: templateUrl(appUrl, candidate.slug),
            imageUrl: templateEmailCardUrl(appUrl, candidate.slug, candidate.cardStamp),
        })
    }
    return resolved
}

async function pickWithModel(shortlist: TemplateCandidate[], answers: OnboardingAnswers | null, context: RecommendContext, appUrl: string): Promise<TemplateRecommendation[] | null> {
    if (!hasOpenRouterKey()) return null

    const slugs = shortlist.map(candidate => candidate.slug) as [string, ...string[]]
    const schema = z.object({
        picks: z
            .array(
                z.object({
                    slug: z.enum(slugs).describe('Copied exactly from the shortlist.'),
                    line: z
                        .string()
                        .describe(
                            `One sentence, ${LINE_LIMIT} characters maximum, saying what this setup produces for this company. Name the concrete output and the service it runs on. No trailing period, never "for you", never the company name.`,
                        ),
                }),
            )
            .min(MIN_PICKS)
            .max(MAX_PICKS),
    })

    try {
        const { object } = await generateObject({
            model: openrouter(RECOMMEND_MODEL),
            schema,
            system: `${VOICE}\n\n${ROLE}`,
            prompt: describeContext(answers, shortlist, context),
            abortSignal: AbortSignal.timeout(20_000),
        })

        const picks = resolvePicks(shortlist, object.picks, appUrl)
        return picks.length >= MIN_PICKS ? picks : null
    } catch (err) {
        console.error('[recommend] template pick failed', err)
        return null
    }
}

export type RecommendResult = { ok: true; picks: TemplateRecommendation[] } | { ok: false; reason: 'too_few' }

export async function recommendTemplates(candidates: TemplateCandidate[], answers: OnboardingAnswers | null, options: { appUrl: string; now?: Date; useModel?: boolean }): Promise<RecommendResult> {
    const context = recommendContext(answers, options.now ?? new Date())
    const shortlist = shortlistTemplates(candidates, context)
    if (shortlist.length < MIN_PICKS) return { ok: false, reason: 'too_few' }

    const picked = options.useModel === false ? null : await pickWithModel(shortlist, answers, context, options.appUrl)
    return { ok: true, picks: picked ?? fallback(shortlist, options.appUrl) }
}
