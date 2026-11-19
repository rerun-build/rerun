import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { randomExpertBannerUrl } from '@moldwright/db'
import { rehostAvatar, rehostBanner } from './rehost'
import { enrichExpert } from './enrich'
import { scrapeProfile } from './scrape'
import { detectExpertSource } from './source'
import { canonicalXUrl, xUsername } from './x-scrape'
import { isValidTimeZone } from './schedule/window'
import { slugifyExpertName } from '@moldwright/ui/experts/options'

export type ImportResult =
    | { url: string; ok: true; slug: string; name: string }
    | { url: string; ok: false; error: string; cause: unknown }

async function uniqueSlug(supabase: SupabaseClient<Database>, base: string): Promise<string> {
    const root = base || 'expert'
    for (let i = 1; i < 100; i++) {
        const slug = i === 1 ? root : `${root}-${i}`
        const { data } = await selectMaybeSingle(supabase, 'experts', ['id'] as const, { slug })
        if (!data) return slug
    }
    throw new Error(`Could not find a free slug for "${root}"`)
}

export async function importExpert(supabase: SupabaseClient<Database>, url: string): Promise<ImportResult> {
    try {
        const source = detectExpertSource(url)
        if (!source) throw new Error(`Unsupported profile URL: ${url}`)

        const scraped = await scrapeProfile(url, source)
        const enriched = await enrichExpert(source, scraped.raw)

        const slugBase = slugifyExpertName(enriched.name) || (source === 'x' ? xUsername(url).toLowerCase() : '')
        const slug = await uniqueSlug(supabase, slugBase)

        const avatar_url = scraped.photoUrl ? await rehostAvatar(supabase, scraped.photoUrl, slug) : null

        const banner_url =
            (scraped.bannerUrl ? await rehostBanner(supabase, scraped.bannerUrl, slug) : null) ??
            (await randomExpertBannerUrl(supabase))
        if (!banner_url) throw new Error('No banner illustration available in the banner-illustrations bucket')

        const row: Database['public']['Tables']['experts']['Insert'] = {
            slug,
            name: enriched.name,
            type: enriched.type,
            email: enriched.email || null,
            location: enriched.location || null,
            timezone: isValidTimeZone(enriched.timezone) ? enriched.timezone : null,
            bio: enriched.bio || null,
            budget: enriched.budget,
            avatar_url,
            banner_url,
            skills: enriched.skills,
            languages: enriched.languages,
            x_url: source === 'x' ? canonicalXUrl(xUsername(url)) : enriched.x_url || null,
            linkedin_url: source === 'linkedin' ? url : enriched.linkedin_url || null,
            github_url: enriched.github_url || null,
            website_url: enriched.website_url || null,
            status: 'draft',
        }
        const { error } = await supabase.from('experts').insert<Database['public']['Tables']['experts']['Insert']>(row)
        if (error) throw new Error(error.message)

        return { url, ok: true, slug, name: enriched.name }
    } catch (err) {
        return { url, ok: false, error: err instanceof Error ? err.message : 'Import failed', cause: err }
    }
}
