import { vaultAccountLabel, type VaultItemSummary } from '@rerun/contracts'

import type { AgentServiceStatus, CustomMcpServer, CustomMcpStatus, InstalledService } from '@/lib/services/types'

// `unknown`: a custom server the engine could not probe, drawn without a status rather than a guess.
export type TileStatus = AgentServiceStatus | 'unknown'

type TileBase = { key: string; slug: string | null; name: string; account?: string; status: TileStatus }

// One thing the coworker holds: an account of a catalog app, a custom MCP server, or an entry the
// Vault lends it (a secret or a server).
export type AppTile =
    | (TileBase & { kind: 'app'; service: InstalledService })
    | (TileBase & { kind: 'mcp'; server: CustomMcpServer; toolCount: number; error?: string })
    | (TileBase & { kind: 'vault'; item: VaultItemSummary })

const MCP_STATUS: Record<CustomMcpStatus['status'], TileStatus> = { connected: 'active', needs_auth: 'needs_auth', error: 'error', unknown: 'unknown' }

export function toTiles(installed: InstalledService[], custom: CustomMcpServer[], customStatuses: ReadonlyMap<string, CustomMcpStatus>, vaultAttached: VaultItemSummary[]): AppTile[] {
    return [
        ...installed.map((service): AppTile => ({ kind: 'app', key: service.key, slug: service.slug, name: service.name, account: service.label, status: service.status, service })),
        ...custom.map((server): AppTile => {
            const live = customStatuses.get(server.name)
            return {
                kind: 'mcp',
                key: `mcp:${server.name}`,
                slug: null,
                name: server.displayName,
                account: server.host ?? server.transport,
                status: live ? MCP_STATUS[live.status] : 'unknown',
                toolCount: live?.toolCount ?? 0,
                error: live?.error,
                server,
            }
        }),
        ...vaultAttached.map((item): AppTile => ({
            kind: 'vault',
            key: `vault:${item.id}`,
            slug: item.slug ?? null,
            name: item.name,
            account: item.kind === 'secret' ? item.envKeys.join(', ') : vaultAccountLabel(item),
            status: 'active',
            item,
        })),
    ]
}

export const isBroken = (status: TileStatus) => status === 'needs_auth' || status === 'needs_config' || status === 'error'

export function worstStatus(tiles: AppTile[]): TileStatus {
    return tiles.find(tile => tile.status === 'error')?.status ?? tiles.find(tile => isBroken(tile.status))?.status ?? tiles[0].status
}

// The accounts of one catalog app share a tile; a server or a Vault entry always stands alone.
export function groupTiles(tiles: AppTile[]): AppTile[][] {
    const groups = new Map<string, AppTile[]>()
    for (const tile of tiles) {
        const id = tile.kind === 'app' ? `app:${tile.slug}` : tile.key
        groups.set(id, [...(groups.get(id) ?? []), tile])
    }
    return [...groups.values()]
}

export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return fields.some(field => field?.toLowerCase().includes(needle))
}

// `found`: the slugs the catalog search returned for this query, which also matches on the summary
// and on meaning ("crm" finds HubSpot). An app the coworker holds is left out of the library, so its
// tile keeps it on screen.
export function tileMatches(query: string, tile: AppTile, found?: ReadonlySet<string>): boolean {
    if (tile.slug && found?.has(tile.slug)) return true
    if (tile.kind === 'mcp') return matchesQuery(query, tile.name, tile.account, tile.server.name)
    if (tile.kind === 'vault') return matchesQuery(query, tile.name, tile.account, tile.slug, vaultAccountLabel(tile.item))
    return matchesQuery(query, tile.name, tile.account, tile.slug)
}

export function vaultEntryMatches(query: string, item: VaultItemSummary, found?: ReadonlySet<string>): boolean {
    if (item.slug && found?.has(item.slug)) return true
    return matchesQuery(query, item.name, vaultAccountLabel(item), item.slug, item.envKeys.join(' '))
}

// An app already on the coworker, or one click away in the Vault, is never offered a second time
// by the library.
export function takenSlugs(tiles: AppTile[], vaultAvailable: VaultItemSummary[]): Set<string> {
    return new Set([...tiles, ...vaultAvailable].flatMap(entry => (entry.slug ? [entry.slug] : [])))
}
