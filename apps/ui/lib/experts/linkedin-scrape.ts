import { runApifyActor } from './apify'

const DEFAULT_ACTOR = 'apimaestro/linkedin-profile-detail'

export type RawLinkedinProfile = Record<string, unknown> & {
    basic_info?: {
        fullname?: string
        first_name?: string
        last_name?: string
        headline?: string
        about?: string
        location?: { full?: string; city?: string; country?: string }
        profile_picture_url?: string
        public_identifier?: string
        creator_website?: string
        top_skills?: unknown
    }
    experience?: unknown
    education?: unknown
}

export function linkedinUsername(url: string): string {
    const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
    const username = match?.[1] ?? url.trim()
    try {
        return decodeURIComponent(username).replace(/\/$/, '')
    } catch {
        throw new Error(`Not a LinkedIn profile link: ${url}`)
    }
}

export async function scrapeLinkedinProfile(url: string): Promise<RawLinkedinProfile> {
    const actor = process.env.APIFY_LINKEDIN_ACTOR ?? DEFAULT_ACTOR
    const [profile] = await runApifyActor<RawLinkedinProfile>(actor, { username: linkedinUsername(url), includeEmail: true })
    if (!profile) throw new Error('Apify returned no profile data')
    return profile
}

export function extractPhotoUrl(profile: RawLinkedinProfile): string | null {
    const candidate = profile.basic_info?.profile_picture_url
    return typeof candidate === 'string' && candidate.startsWith('http') ? candidate : null
}
