// HTML an agent publishes is served from its own `<slug>.rerun.site` origin, never from the app's:
// a page with scripts on app.rerun.build could read the session, and a fake sign-in form would sit
// under our own address bar. One origin per slug also keeps two published mini-apps from reading
// each other's localStorage. PUBLISH_HOST unset (staging) turns the whole thing off: HTML keeps
// redirecting to Storage like any other file. In dev, `localhost:3050` serves `<slug>.localhost:3050`.
import { isOpaqueToken } from '@/lib/opaque-token'

// Names a slug can never take: the hosts DNS already answers for under rerun.site, plus the obvious
// infrastructure ones a visitor would trust.
const RESERVED_SLUGS = new Set(['www', 'app', 'api', 'admin', 'auth', 'mail', 'welcome', 'links', 'send', 'staging', 'static', 'assets', 'cdn'])

// A DNS label: lowercase alphanumerics and inner hyphens, 2 to 63 characters.
const SLUG_LABEL = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

export const PUBLISHED_SITE_ROUTE = '/published-site'

function publishHost(): string | null {
    return process.env.PUBLISH_HOST?.trim().toLowerCase() || null
}

function hostname(host: string): string {
    return host.split(':')[0].toLowerCase()
}

export function isReservedSlug(slug: string): boolean {
    return RESERVED_SLUGS.has(slug) || slug.startsWith('xn--')
}

export function isValidSlugLabel(slug: string): boolean {
    return SLUG_LABEL.test(slug) && !isReservedSlug(slug)
}

// A chosen name only ever prefixes a random token: a bare `stripe-login` would look official, be
// guessable, and be taken platform-wide by whoever asked first. The token is as long behind a
// name as on its own, since a guessable name leaves it as the whole security argument.
export const PUBLISHED_SLUG_TOKEN_LENGTH = 10
const MAX_SLUG_PREFIX = 63 - 1 - PUBLISHED_SLUG_TOKEN_LENGTH

// A full slug handed back (`q2-report-k3m9xqw7pt`) loses its token first, so it is never suffixed twice.
export function slugPrefix(customSlug: string): string {
    const name = customSlug.trim().toLowerCase()
    const dash = name.lastIndexOf('-')
    const tail = dash === -1 ? '' : name.slice(dash + 1)
    const bare = isOpaqueToken(tail, PUBLISHED_SLUG_TOKEN_LENGTH) ? name.slice(0, dash) : name
    return bare.slice(0, MAX_SLUG_PREFIX).replace(/-+$/, '')
}

export function suffixedSlug(customSlug: string, suffix: string): string {
    const slug = `${slugPrefix(customSlug)}-${suffix}`
    if (!isValidSlugLabel(slug)) {
        throw new Error('Invalid slug: use lowercase letters, digits and hyphens, starting with a letter or digit.')
    }
    return slug
}

export function extractPublishedSlug(host: string | null | undefined): string | null {
    const base = publishHost()
    if (!host || !base) return null
    const suffix = `.${hostname(base)}`
    const h = hostname(host)
    if (!h.endsWith(suffix)) return null
    const slug = h.slice(0, -suffix.length)
    return isValidSlugLabel(slug) ? slug : null
}

export function publishedSiteOrigin(slug: string): string | null {
    const base = publishHost()
    if (!base) return null
    const name = hostname(base)
    const protocol = name === 'localhost' || name.endsWith('.localhost') ? 'http' : 'https'
    return `${protocol}://${slug}.${base}`
}

// Storage would show these as source text, so their link has to point at the publish host.
export function rendersAsPage(kind: string, contentType: string): boolean {
    return kind === 'site' || contentType.startsWith('text/html')
}

// On the publish host the link of a single file opens the viewer page; its bytes are at `/__rerun/raw`.
export function publishedRawFileUrl(slug: string): string | null {
    const origin = publishedSiteOrigin(slug)
    return origin ? `${origin}/__rerun/raw` : null
}
