import { describe, expect, it } from 'vitest'

import type { VaultItemSummary } from '@rerun/contracts'

import type { CustomMcpServer, CustomMcpStatus, InstalledService } from '@/lib/services/types'

import { groupTiles, takenSlugs, tileMatches, toTiles, vaultEntryMatches, worstStatus } from './apps-tab'

function app(key: string, slug: string, name: string, status: InstalledService['status'] = 'active', label?: string): InstalledService {
    return { key, slug, name, label, status, icon: null, category: 'other', toolNames: [], installedAt: '2026-11-26T00:00:00Z' }
}

function vaultItem(id: string, kind: VaultItemSummary['kind'], name: string, extra: Partial<VaultItemSummary> = {}): VaultItemSummary {
    return { id, kind, name, slug: null, envKeys: [], tokens: [], agentIds: [], sharedWithAll: false, createdBy: null, createdAt: '', updatedAt: '', status: 'active', config: {}, mcpServers: [], skills: [], ...extra } as VaultItemSummary
}

const crm: CustomMcpServer = { name: 'acme-crm', displayName: 'Acme CRM', transport: 'http', host: 'crm.acme.co', icon: null, signInUrl: null }
const installed = [app('gmail', 'gmail', 'Gmail'), app('getxapi', 'getxapi', 'GetXAPI', 'active', 'Clement Social'), app('gmail:2', 'gmail', 'Gmail', 'needs_auth', 'sales@acme.co'), app('linear', 'linear', 'Linear', 'needs_auth')]
const statuses = new Map<string, CustomMcpStatus>([['acme-crm', { name: 'acme-crm', status: 'error', toolCount: 0, error: 'The server did not answer.' }]])
const attached = [vaultItem('v-weather', 'secret', 'OpenWeather key', { envKeys: ['OPENWEATHER_API_KEY'] })]
const available = [vaultItem('v-getx-2', 'service', 'GetXAPI', { slug: 'getxapi', label: 'X LM Publisher' }), vaultItem('v-hubspot', 'service', 'HubSpot', { slug: 'hubspot', label: 'Sales team' })]

const tiles = toTiles(installed, [crm], statuses, attached)

describe('the tiles of the Apps tab', () => {
    it('turns apps, servers and Vault entries into tiles', () => {
        expect(tiles.map(tile => [tile.kind, tile.name, tile.account, tile.status])).toEqual([
            ['app', 'Gmail', undefined, 'active'],
            ['app', 'GetXAPI', 'Clement Social', 'active'],
            ['app', 'Gmail', 'sales@acme.co', 'needs_auth'],
            ['app', 'Linear', undefined, 'needs_auth'],
            ['mcp', 'Acme CRM', 'crm.acme.co', 'error'],
            ['vault', 'OpenWeather key', 'OPENWEATHER_API_KEY', 'active'],
        ])
    })

    it('draws a server the engine could not probe without a status', () => {
        expect(toTiles([], [crm], new Map(), [])[0].status).toBe('unknown')
    })

    it('puts the accounts of one app in one tile, with its worst status', () => {
        const groups = groupTiles(tiles)
        expect(groups.map(group => group.length)).toEqual([2, 1, 1, 1, 1])
        expect(worstStatus(groups[0])).toBe('needs_auth')
        expect(worstStatus([tiles[0], tiles[2], tiles[4]])).toBe('error')
    })

    it('never groups two servers or two Vault entries', () => {
        const twoKeys = toTiles([], [], new Map(), [attached[0], vaultItem('v-openai', 'secret', 'OpenAI key')])
        expect(groupTiles(twoKeys)).toHaveLength(2)
    })
})

describe('the search of the Apps tab', () => {
    it('keeps one tile and one Vault line for "getx"', () => {
        expect(tiles.filter(tile => tileMatches('getx', tile)).map(tile => tile.name)).toEqual(['GetXAPI'])
        expect(available.filter(item => vaultEntryMatches('getx', item)).map(item => item.id)).toEqual(['v-getx-2'])
    })

    it('finds a tile by its account and a key by its variable', () => {
        expect(tiles.filter(tile => tileMatches('acme', tile)).map(tile => tile.key)).toEqual(['gmail:2', 'mcp:acme-crm'])
        expect(tiles.filter(tile => tileMatches('openweather_api', tile)).map(tile => tile.key)).toEqual(['vault:v-weather'])
    })

    it('keeps what the catalog search found by its summary, but never a server without a slug', () => {
        const withHubspot = toTiles([...installed, app('hubspot', 'hubspot', 'HubSpot')], [crm], statuses, attached)
        const found = new Set(['hubspot', 'getxapi'])
        expect(withHubspot.filter(tile => tileMatches('crm', tile, found)).map(tile => tile.key)).toEqual(['getxapi', 'hubspot', 'mcp:acme-crm'])
        expect(withHubspot.filter(tile => tileMatches('zzqx', tile, found)).map(tile => tile.key)).toEqual(['getxapi', 'hubspot'])
        expect(available.filter(item => vaultEntryMatches('zzqx', item, found)).map(item => item.id)).toEqual(['v-getx-2', 'v-hubspot'])
        expect(available.filter(item => vaultEntryMatches('zzqx', item, new Set())).map(item => item.id)).toEqual([])
    })

    it('keeps an app the coworker holds or the Vault offers out of the library', () => {
        expect([...takenSlugs(tiles, available)].sort()).toEqual(['getxapi', 'gmail', 'hubspot', 'linear'])
    })
})
