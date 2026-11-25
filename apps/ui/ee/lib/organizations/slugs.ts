import { slugify } from '@/lib/slugify'

// The label of an organization's default address, `<slug>.rerun.work`. Mirrors the check of
// `organizations.slug`, minus a double dash: `xn--` is how a browser writes another alphabet.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const MAX_SLUG_LENGTH = 40

// Addresses of ours, of the mail of the domain, and the ones a client would take for ours.
const RESERVED = new Set([
    'abuse', 'account', 'accounts', 'admin', 'administrator', 'affiliate', 'api', 'app', 'apps', 'assets', 'auth', 'autoconfig', 'autodiscover',
    'billing', 'blog', 'cdn', 'community', 'console', 'custom', 'dashboard', 'demo', 'dev', 'dns', 'docs', 'download', 'edge', 'email', 'engine', 'files', 'ftp',
    'help', 'hostmaster', 'hub', 'imap', 'info', 'internal', 'legal', 'local', 'localhost', 'login', 'logout', 'mail', 'mcp', 'media', 'mta-sts',
    'news', 'no-reply', 'noreply', 'notifications', 'ns1', 'ns2', 'oauth', 'organization', 'organizations', 'partners', 'pay', 'payment', 'payments', 'pop', 'postmaster', 'preview', 'prod', 'production',
    'public', 'root', 'secure', 'security', 'send', 'sign-in', 'sign-up', 'signin', 'signup', 'smtp', 'sso', 'staging', 'static', 'status', 'stripe', 'support', 'system',
    'team', 'test', 'tests', 'trust', 'verify', 'webhook', 'webhooks', 'webmail', 'webmaster', 'work', 'www',
])
const RESERVED_FAMILY = /^(?:rerun|staging|test|edge|mx|ns)(?:-.*|\d*)$/

export function isReservedSlug(slug: string): boolean {
    return RESERVED.has(slug) || RESERVED_FAMILY.test(slug)
}

export type SlugProblem = 'invalid' | 'reserved'

export function slugProblem(slug: string): SlugProblem | null {
    if (!SLUG.test(slug) || slug.includes('--')) return 'invalid'
    return isReservedSlug(slug) ? 'reserved' : null
}

// What an organization's name becomes, or nothing when it cannot be one.
export function suggestSlug(name: string): string {
    const slug = slugify(name, { maxLength: MAX_SLUG_LENGTH })
    return slugProblem(slug) ? '' : slug
}
