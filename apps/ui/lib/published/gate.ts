import { internalPath } from '@/lib/auth/internal-path'
import 'server-only'
import type { Database } from '@/app/api/database.types'
import { isPublishedAccess, type PublishedAccess } from '@/lib/published/access'
import { mintAccessCookie, openAccessCookie, type AccessClaims, type AccessGrant } from '@/lib/published/access-ticket'
import { publishedSiteOrigin } from '@/lib/published/host'
import { resolveSitePath } from '@/lib/published/site-path'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// Everything `<slug>.rerun.site` decides before it serves a byte: which link the host names, whether
// the visitor may open it, and what they see when they may not (the gate) or when the link is a
// single file a browser would only download (the viewer).

export const PUBLISHED_GATE_ROUTE = '/published-gate'
export const PUBLISHED_VIEW_ROUTE = '/published-view'
export { PUBLISHED_PAGE_MARKER } from '@/lib/published/marker'

// The paths a published host keeps for itself, out of any site's reach: a site file can never be
// named `__rerun`, since a published folder skips nothing but dotfiles.
export const RESERVED_PREFIX = '/__rerun/'

export const GATE_ERROR_PARAM = 'rr_error'
export const GATE_EMAIL_PARAM = 'rr_email'
export type GateError = 'password' | 'code' | 'limited' | 'email'

const PUBLISHED_ENTRY_COLUMNS = ['id', 'slug', 'workspace_id', 'agent_id', 'source_path', 'kind', 'content_type', 'size', 'storage_key', 'files', 'title', 'access', 'invited', 'password_hash', 'access_version', 'thumbnail_key', 'updated_at'] as const

type Row = Pick<Database['public']['Tables']['published_files']['Row'], (typeof PUBLISHED_ENTRY_COLUMNS)[number]>
export type PublishedEntry = Omit<Row, 'access'> & { access: PublishedAccess }

export async function loadPublished(slug: string): Promise<PublishedEntry | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'published_files', PUBLISHED_ENTRY_COLUMNS, { slug })
    if (!data) return null
    // A value the check constraint rules out reads as the narrowest access, never the widest.
    return { ...data, access: isPublishedAccess(data.access) ? data.access : 'workspace' }
}

export type WorkspaceBrand = { name: string; iconUrl: string | null }

export async function loadWorkspaceBrand(workspaceId: number): Promise<WorkspaceBrand> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['name', 'icon_url'] as const, { id: workspaceId })
    return { name: data?.name ?? 'Rerun', iconUrl: data?.icon_url ?? null }
}

export function isHtmlContentType(contentType: string): boolean {
    return contentType.startsWith('text/html')
}

// A page or a site renders itself. Any other single file opens in the viewer at the root of its host.
export function opensInViewer(entry: Pick<PublishedEntry, 'kind' | 'content_type'>): boolean {
    return entry.kind !== 'site' && !isHtmlContentType(entry.content_type)
}

// On a secure origin the cookie takes the `__Host-` prefix, which pins it to this host and path `/`
// whatever a page's script tries. Plain-HTTP dev hosts (`<slug>.localhost`) cannot carry it.
export function accessCookieName(secure: boolean): string {
    return secure ? '__Host-rr_access' : 'rr_access'
}

export function isSecureRequest(request: Request): boolean {
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    return (forwarded ?? new URL(request.url).protocol.replace(':', '')) === 'https'
}

export function readAccessCookie(cookieHeader: string | null, secure: boolean): string | null {
    const name = accessCookieName(secure)
    for (const part of (cookieHeader ?? '').split(';')) {
        const [key, ...value] = part.trim().split('=')
        if (key === name) return value.join('=')
    }
    return null
}

export function grantFor(entry: Pick<PublishedEntry, 'slug' | 'access' | 'access_version'>, cookie: string | null): AccessClaims | null {
    const claims = openAccessCookie(cookie, entry.slug)
    return claims && claims.v === entry.access_version ? claims : null
}

// Members pass whatever the mode: a link is always open to the workspace that published it.
export function mayOpen(entry: Pick<PublishedEntry, 'slug' | 'access' | 'access_version'>, cookie: string | null): boolean {
    if (entry.access === 'public') return true
    const grant = grantFor(entry, cookie)
    if (!grant) return false
    if (grant.grant === 'member' || grant.grant === 'shot') return true
    if (entry.access === 'password') return grant.grant === 'password'
    if (entry.access === 'invited') return grant.grant === 'invite'
    return false
}

export function accessCookieHeader(entry: Pick<PublishedEntry, 'slug' | 'access_version'>, grant: AccessGrant, sub: string, secure: boolean, maxAgeSeconds: number): string {
    const value = mintAccessCookie({ slug: entry.slug, v: entry.access_version, grant, sub })
    return [`${accessCookieName(secure)}=${value}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ')
}

export function clearAccessCookieHeader(secure: boolean): string {
    return [`${accessCookieName(secure)}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ')
}

// Only a path on the same host, so a gate can never be turned into a redirect to anywhere else.
export function safeNextPath(raw: string | null | undefined): string {
    const path = internalPath(raw, '/')
    return path.startsWith(RESERVED_PREFIX) ? '/' : path
}

export function siteFileExists(entry: Pick<PublishedEntry, 'kind' | 'files'>, pathname: string): boolean {
    if (entry.kind !== 'site') return false
    const segments = pathname
        .split('/')
        .filter(Boolean)
        .map(segment => decodeURIComponent(segment))
    return resolveSitePath(segments, entry.files ?? []) !== null
}

export function publishedUrl(slug: string, path = '/'): string | null {
    const origin = publishedSiteOrigin(slug)
    return origin ? `${origin}${path}` : null
}

export type GateKind = 'password' | 'invited' | 'workspace'

export function gateKindOf(access: PublishedAccess): GateKind | null {
    return access === 'public' ? null : access
}

// The preview card's address names the state it was drawn for, so a crawler that cached the card of
// a public link fetches a fresh one once the link is protected, and the other way round.
export function previewImageUrl(entry: Pick<PublishedEntry, 'access_version' | 'updated_at'>, origin: string): string {
    return `${origin}/__rerun/og.png?v=${entry.access_version}-${Date.parse(entry.updated_at)}`
}
