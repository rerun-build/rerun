import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { enrichExpert, type EnrichedExpert } from './enrich'
import { rehostAvatar } from './rehost'
import { scrapeProfile } from './scrape'
import { isValidTimeZone } from './schedule/window'
import { detectExpertSource, type ExpertSource } from './source'
import { canonicalXUrl, xUsername } from './x-scrape'

export const PREFILL_COLUMNS = [
    'id',
    'slug',
    'avatar_url',
    'location',
    'timezone',
    'bio',
    'budget',
    'skills',
    'languages',
    'x_url',
    'linkedin_url',
    'github_url',
    'website_url',
] as const

export type ExpertPrefillRow = Pick<Database['public']['Tables']['experts']['Row'], (typeof PREFILL_COLUMNS)[number]>

export type PrefillResult = { ok: true; slug: string; source: ExpertSource } | { ok: false; reason: 'not-found' | 'no-profile-url' }

type PrefilledUrl = { url: string; source: ExpertSource }

export function pickProfileUrl(expert: Pick<ExpertPrefillRow, 'linkedin_url' | 'x_url'>): PrefilledUrl | null {
    for (const candidate of [expert.linkedin_url, expert.x_url]) {
        const url = candidate?.trim()
        if (!url) continue
        const source = detectExpertSource(url)
        if (source) return { url, source }
    }
    return null
}

export function prefillPatch(
    expert: ExpertPrefillRow,
    enriched: EnrichedExpert,
    source: ExpertSource,
    url: string,
    avatarUrl: string | null,
): Database['public']['Tables']['experts']['Update'] {
    const patch: Database['public']['Tables']['experts']['Update'] = {}

    const fill = (
        key: 'location' | 'timezone' | 'bio' | 'budget' | 'avatar_url' | 'github_url' | 'website_url' | 'x_url' | 'linkedin_url',
        current: string | null,
        incoming: string | null,
    ) => {
        if (current?.trim()) return
        const next = incoming?.trim()
        if (next) patch[key] = next
    }

    fill('location', expert.location, enriched.location)
    fill('timezone', expert.timezone, isValidTimeZone(enriched.timezone) ? enriched.timezone : null)
    fill('bio', expert.bio, enriched.bio)
    fill('budget', expert.budget, enriched.budget)
    fill('avatar_url', expert.avatar_url, avatarUrl)
    fill('github_url', expert.github_url, enriched.github_url)
    fill('website_url', expert.website_url, enriched.website_url)
    fill('x_url', expert.x_url, source === 'x' ? canonicalXUrl(xUsername(url)) : enriched.x_url)
    fill('linkedin_url', expert.linkedin_url, source === 'linkedin' ? url : enriched.linkedin_url)

    if (expert.skills.length === 0 && enriched.skills.length > 0) patch.skills = enriched.skills
    if (expert.languages.length === 0 && enriched.languages.length > 0) patch.languages = enriched.languages

    return patch
}

export async function prefillExpertFromProfile(supabase: SupabaseClient<Database>, expertId: string): Promise<PrefillResult> {
    const { data: expert } = await selectMaybeSingle(supabase, 'experts', PREFILL_COLUMNS, { id: expertId })
    if (!expert) return { ok: false, reason: 'not-found' }

    const picked = pickProfileUrl(expert)
    if (!picked) return { ok: false, reason: 'no-profile-url' }

    const scraped = await scrapeProfile(picked.url, picked.source)
    const enriched = await enrichExpert(picked.source, scraped.raw)

    const avatarUrl = !expert.avatar_url && scraped.photoUrl ? await rehostAvatar(supabase, scraped.photoUrl, expert.slug) : null

    const patch = prefillPatch(expert, enriched, picked.source, picked.url, avatarUrl)
    if (Object.keys(patch).length === 0) return { ok: true, slug: expert.slug, source: picked.source }

    const payload: Database['public']['Tables']['experts']['Update'] = { ...patch, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('experts').update<Database['public']['Tables']['experts']['Update']>(payload).eq('id', expertId)
    if (error) throw new Error(error.message)

    return { ok: true, slug: expert.slug, source: picked.source }
}
