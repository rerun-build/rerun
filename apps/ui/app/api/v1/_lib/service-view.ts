import type { Actor } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { getCatalogServicesBySlugs, getServiceDetails } from '@/app/api/_services/services.service'
import { appOrigin } from '@/lib/managed/oauth'
import { mintConnectTicket } from '@/lib/oauth/mobile-ticket'
import type { InstallResult, ServiceDetails, ServiceSearchResult } from '@/lib/services/types'
import { type DesktopShellChannel, type InstallResultView, type PendingAuth, type ResolvedService, type ServiceSearchResultView, parseDesktopShellUserAgent, parseServiceRegistryKey } from '@rerun/contracts'

// The app never holds a sign-in target: it gets which flow is waiting, and the hub reads the target
// back from the registry when the flow starts.
function pendingAuthOf(target: { oauth?: unknown; managed?: unknown; composio?: unknown; app?: unknown }): PendingAuth | null {
    if (target.app) return 'app'
    if (target.managed) return 'managed'
    if (target.composio) return 'composio'
    if (target.oauth) return 'oauth'
    return null
}

export function toResolvedService(details: ServiceDetails, catalog: ServiceSearchResult | undefined, reason?: string): ResolvedService {
    return {
        key: details.key,
        slug: details.slug,
        ...(details.label ? { label: details.label } : {}),
        name: details.name,
        category: details.category,
        summary: details.summary,
        icon: catalog?.icon ?? null,
        verified: catalog?.verified ?? false,
        reason,
        authMethods: details.authMethods,
        installStatus: details.installStatus,
        installedMethodId: details.installedMethodId,
        pendingAuth: details.installStatus === 'needs_auth' ? pendingAuthOf(details) : null,
        notFound: false,
        multiInstance: details.multiInstance,
    }
}

function notFound(slug: string, reason?: string): ResolvedService {
    return { slug, name: slug, category: 'other', summary: '', icon: null, verified: false, reason, authMethods: [], installStatus: null, pendingAuth: null, notFound: true, multiInstance: false }
}

// One card per suggested slug, in the agent's order. A slug the catalog does not know (or with no
// auth method at all) becomes a `notFound` card rather than failing the whole block. A registry key
// (`gmail@k3x9ab`) resolves to that one account of the app.
export async function resolveServices(agentId: string, suggested: { slug: string; reason?: string }[], actor: Actor): Promise<ResolvedService[]> {
    const keys = suggested.map(s => s.slug)
    const [details, catalog] = await Promise.all([
        Promise.all(keys.map(key => getServiceDetails(agentId, key, actor).catch(() => null))),
        getCatalogServicesBySlugs(keys.map(key => parseServiceRegistryKey(key).slug)),
    ])
    const bySlug = new Map(catalog.map(c => [c.slug, c]))
    return suggested.map((s, i) => {
        const d = details[i]
        return d && d.authMethods.length > 0 ? toResolvedService(d, bySlug.get(d.slug), s.reason) : notFound(s.slug, s.reason)
    })
}

// Whether Next hands a dynamic segment over decoded has varied between versions. A registry key never
// holds a '%', so decoding one that already is changes nothing.
export function serviceKeyParam(params: Record<string, string>): string {
    return decodeURIComponent(params.slug)
}

// The desktop app asks from its own window, its User-Agent naming its channel: the sign-in returns
// to its URL scheme instead of the iOS app's.
export function requestingDesktop(req: Request): DesktopShellChannel | undefined {
    return parseDesktopShellUserAgent(req.headers.get('user-agent'))?.channel
}

export function connectUrl(req: Request, ctx: WorkspaceContext, agentId: string, key: string): string {
    const ticket = mintConnectTicket({ agentId, key, workspaceId: ctx.workspace.id, userId: ctx.userId, desktop: requestingDesktop(req) })
    return `${appOrigin(req)}/api/oauth/mobile/start?t=${encodeURIComponent(ticket)}`
}

export function mcpConnectUrl(req: Request, ctx: WorkspaceContext, agentId: string, server: string): string {
    const ticket = mintConnectTicket({ agentId, server, workspaceId: ctx.workspace.id, userId: ctx.userId, desktop: requestingDesktop(req) })
    return `${appOrigin(req)}/api/oauth/mobile/start?t=${encodeURIComponent(ticket)}`
}

export function toInstallResultView(result: InstallResult, req: Request, ctx: WorkspaceContext, agentId: string): InstallResultView {
    if (result.status !== 'needs_auth') return result
    return { status: 'needs_auth', key: result.key, slug: result.slug, name: result.name, message: result.message, pendingAuth: pendingAuthOf(result) ?? 'oauth', connectUrl: connectUrl(req, ctx, agentId, result.key) }
}

export function toSearchResultView(result: ServiceSearchResult): ServiceSearchResultView {
    return { slug: result.slug, name: result.name, category: result.category, summary: result.summary, icon: result.icon, requiresSecrets: result.requiresSecrets, installed: result.installed, installStatus: result.installStatus, verified: result.verified, multiInstance: result.multiInstance }
}
