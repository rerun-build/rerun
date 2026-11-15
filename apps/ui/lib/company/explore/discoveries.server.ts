import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { extractPhotoUrl } from '@/lib/experts/linkedin-scrape'
import { selectMany } from '@/supabase/supabase-helpers'
import type { CollectorId } from './catalog'
import type { ExploreEvent } from './explore'
import type { CompanyFinding, DiscoveryEvent, DiscoverySource } from './findings'
import { SOCIAL_NETWORKS, type SocialNetwork, type SocialProfiles } from './social'
import type { CollectorData } from './types'

const SOCIAL_LABELS: Record<SocialNetwork, string> = {
    linkedin: 'LinkedIn',
    instagram: 'Instagram',
    x: 'X',
    facebook: 'Facebook',
    youtube: 'YouTube',
    tiktok: 'TikTok',
    github: 'GitHub',
    pinterest: 'Pinterest',
    threads: 'Threads',
}

const NOT_TOOLS = new Set(['Framework'])

const MAIL_ICON_NAMES: Record<string, string> = { 'Google Workspace': 'Gmail', 'Microsoft 365': 'Outlook' }

const MAX_TOOLS = 12
const MAX_ITEMS = 6
const MAX_COLORS = 5

export type DiscoveryDraft = {
    identity: { name: string | null; oneLiner: string | null; logoUrl: string | null }
    tools: string[]
    networks: { name: string; audience: string | null }[]
}

export const emptyDiscoveryDraft = (): DiscoveryDraft => ({ identity: { name: null, oneLiner: null, logoUrl: null }, tools: [], networks: [] })

const clean = (value: string | null | undefined) => value?.trim() || null

function items(values: (string | null | undefined)[]): string[] {
    return [...new Set(values.map(clean).filter((value): value is string => Boolean(value)))].slice(0, MAX_ITEMS)
}

function addTools(draft: DiscoveryDraft, names: string[]): boolean {
    const before = draft.tools.length
    for (const name of names.map(value => value.trim())) {
        if (draft.tools.length >= MAX_TOOLS) break
        if (name && !draft.tools.some(tool => tool.toLowerCase() === name.toLowerCase())) draft.tools.push(name)
    }
    return draft.tools.length > before
}

function networkLabel(network: string): string {
    const id = SOCIAL_NETWORKS.find(known => known === network.trim().toLowerCase() || SOCIAL_LABELS[known].toLowerCase() === network.trim().toLowerCase())
    return id ? SOCIAL_LABELS[id] : network.trim()
}

function addNetworks(draft: DiscoveryDraft, networks: { name: string; audience: string | null }[]): boolean {
    let changed = false
    for (const network of networks) {
        const name = networkLabel(network.name)
        if (!name) continue
        const existing = draft.networks.find(known => known.name === name)
        if (!existing) {
            draft.networks.push({ name, audience: network.audience })
            changed = true
        } else if (network.audience && existing.audience !== network.audience) {
            existing.audience = network.audience
            changed = true
        }
    }
    return changed
}

const profileNetworks = (profiles: SocialProfiles) => Object.keys(profiles).map(network => ({ name: network, audience: null }))

function setIdentity(draft: DiscoveryDraft, patch: Partial<DiscoveryDraft['identity']>, { keep }: { keep: boolean }): boolean {
    let changed = false
    for (const key of ['name', 'oneLiner', 'logoUrl'] as const) {
        const value = clean(patch[key])
        if (!value || draft.identity[key] === value || (keep && draft.identity[key])) continue
        draft.identity[key] = value
        changed = true
    }
    return changed
}

function cards(draft: DiscoveryDraft, source: DiscoverySource, domain: string, changed: { identity?: boolean; tools?: boolean; networks?: boolean }): CompanyFinding[] {
    const { name, oneLiner, logoUrl } = draft.identity
    return [
        ...(changed.identity && name ? [{ kind: 'identity' as const, source, name, oneLiner, logoUrl, domain }] : []),
        ...(changed.tools && draft.tools.length ? [{ kind: 'tools' as const, source, tools: draft.tools.map(tool => ({ name: tool, iconUrl: null })) }] : []),
        ...(changed.networks && draft.networks.length ? [{ kind: 'social' as const, source, networks: draft.networks.map(network => ({ ...network, iconUrl: null })) }] : []),
    ]
}

export type SiteRead = { name?: string | null; description?: string | null; audience?: string | null }

export function findingsForProfile(profile: SiteRead, draft: DiscoveryDraft, domain: string): CompanyFinding[] {
    const identity = setIdentity(draft, { name: profile.name, oneLiner: profile.description }, { keep: false })
    const audience = clean(profile.audience)
    return [...cards(draft, 'profile', domain, { identity }), ...(audience ? [{ kind: 'audience' as const, source: 'profile' as const, text: audience }] : [])]
}

export function findingsForCollector<K extends CollectorId>(id: K, data: CollectorData[K], draft: DiscoveryDraft, domain: string): CompanyFinding[] {
    switch (id) {
        case 'dns': {
            const dns = data as CollectorData['dns']
            const tools = addTools(draft, dns.services.map(service => service.name).filter(name => name !== dns.mailProvider))
            const mail = dns.mailProvider ? [{ kind: 'mail' as const, source: id, provider: dns.mailProvider, iconUrl: null }] : []
            return [...mail, ...cards(draft, id, domain, { tools })]
        }
        case 'stack': {
            const stack = data as CollectorData['stack']
            const tools = addTools(draft, stack.technologies.filter(technology => !NOT_TOOLS.has(technology.category)).map(technology => technology.name))
            const networks = addNetworks(draft, profileNetworks(stack.social))
            const identity = setIdentity(draft, { name: stack.meta.siteName, oneLiner: stack.meta.description, logoUrl: stack.meta.favicon }, { keep: true })
            return cards(draft, id, domain, { identity, tools, networks })
        }
        case 'site': {
            const site = data as CollectorData['site']
            const networks = addNetworks(draft, profileNetworks(site.social))
            const identity = setIdentity(draft, { logoUrl: site.branding?.logo }, { keep: false })
            const colors = [...new Set(Object.values(site.branding?.colors ?? {}))].filter(color => /^#[0-9a-f]{3,8}$/i.test(color)).slice(0, MAX_COLORS)
            const brand = colors.length ? [{ kind: 'brand' as const, source: id, colors, fonts: (site.branding?.fonts ?? []).slice(0, 2) }] : []
            return [...cards(draft, id, domain, { identity, networks }), ...brand]
        }
        case 'registry': {
            const registry = data as CollectorData['registry']
            const company = registry.company
            if (!company || (registry.matchedBy !== 'siren' && !registry.personIsOfficer)) return []
            const founded = company.createdAt?.slice(0, 4) ?? null
            if (!founded && !company.headcount && !company.city) return []
            return [{ kind: 'registry', source: id, founded, headcount: company.headcount, city: company.city }]
        }
        case 'linkedinPerson': {
            const { profile } = data as CollectorData['linkedinPerson']
            const info = profile.basic_info
            const name = clean(info?.fullname) ?? clean([info?.first_name, info?.last_name].filter(Boolean).join(' '))
            if (!name) return []
            return [{ kind: 'person', source: id, name, headline: clean(info?.headline), photoUrl: extractPhotoUrl(profile) }]
        }
        case 'linkedinCompany': {
            const { matchesWebsite, company } = data as CollectorData['linkedinCompany']
            if (!matchesWebsite) return []
            const identity = setIdentity(draft, { logoUrl: company.logo }, { keep: true })
            const followers = company.followerCount ?? null
            const employees = company.employeeCount ?? null
            const linkedin = followers !== null || employees !== null ? [{ kind: 'linkedin' as const, source: id, followers, employees }] : []
            return [...cards(draft, id, domain, { identity }), ...linkedin]
        }
        case 'googleBusiness': {
            const { matchesWebsite, place } = data as CollectorData['googleBusiness']
            if (!matchesWebsite || !place.totalScore || !place.reviewsCount) return []
            return [{ kind: 'reviews', source: id, rating: place.totalScore, count: place.reviewsCount }]
        }
        case 'synthesis': {
            const { card } = data as CollectorData['synthesis']
            const identity = setIdentity(draft, { name: card.company.name, oneLiner: card.company.oneLiner, logoUrl: card.branding.logo }, { keep: false })
            const tools = addTools(draft, card.stack)
            const networks = addNetworks(draft, card.presence.channels.map(channel => ({ name: channel.network, audience: clean(channel.audience) })))
            const audience = clean(card.market.idealCustomer) ?? clean(card.market.audience)
            const lists = [
                { kind: 'products' as const, items: items(card.offering.products) },
                { kind: 'competitors' as const, items: items(card.market.competitors) },
                { kind: 'customers' as const, items: items(card.market.notableCustomers) },
            ]
            return [
                ...cards(draft, id, domain, { identity, tools, networks }),
                ...(audience ? [{ kind: 'audience' as const, source: id, text: audience }] : []),
                ...lists.filter(list => list.items.length).map(list => ({ ...list, source: id })),
            ]
        }
        default:
            return []
    }
}

export type IconLookup = (names: string[]) => Promise<Map<string, string>>

export function serviceIconLookup(supabase: SupabaseClient<Database>): IconLookup {
    let catalog: Promise<Map<string, string>> | null = null

    const readCatalog = async () => {
        const { data, error } = await selectMany(supabase, 'services', ['name', 'icon'] as const, {})
        if (error) {
            catalog = null
            throw new Error(error.message)
        }
        return new Map((data ?? []).flatMap(row => (row.icon ? [[row.name.toLowerCase(), row.icon] as const] : [])))
    }

    return async names => {
        if (!names.length) return new Map()
        catalog ??= readCatalog()
        const icons = await catalog
        return new Map(
            names.flatMap(name => {
                const icon = icons.get(name.toLowerCase())
                return icon ? [[name.toLowerCase(), icon] as const] : []
            })
        )
    }
}

function iconNames(finding: CompanyFinding): string[] {
    if (finding.kind === 'tools') return finding.tools.map(tool => tool.name)
    if (finding.kind === 'social') return finding.networks.map(network => network.name)
    if (finding.kind === 'mail') return [MAIL_ICON_NAMES[finding.provider] ?? finding.provider]
    return []
}

function withIcon(finding: CompanyFinding, icons: Map<string, string>): CompanyFinding {
    const icon = (name: string) => icons.get(name.toLowerCase()) ?? null
    if (finding.kind === 'tools') return { ...finding, tools: finding.tools.map(tool => ({ ...tool, iconUrl: icon(tool.name) })) }
    if (finding.kind === 'social') return { ...finding, networks: finding.networks.map(network => ({ ...network, iconUrl: icon(network.name) })) }
    if (finding.kind === 'mail') return { ...finding, iconUrl: icon(MAIL_ICON_NAMES[finding.provider] ?? finding.provider) }
    return finding
}

export function createDiscoveryTranslator({ domain: host, icons }: { domain: string; icons: IconLookup }) {
    const domain = host.replace(/^www\./i, '')
    const draft = emptyDiscoveryDraft()
    const started = new Set<CollectorId>()
    const iconCache = new Map<string, string | null>()

    async function resolveIcons(findings: CompanyFinding[]): Promise<CompanyFinding[]> {
        const missing = [...new Set(findings.flatMap(iconNames))].filter(name => !iconCache.has(name.toLowerCase()))
        if (missing.length) {
            const found = await icons(missing).catch(() => new Map<string, string>())
            for (const name of missing) iconCache.set(name.toLowerCase(), found.get(name.toLowerCase()) ?? null)
        }
        const known = new Map([...iconCache].flatMap(([name, url]) => (url ? [[name, url] as const] : [])))
        return findings.map(finding => withIcon(finding, known))
    }

    async function found(source: DiscoverySource, findings: CompanyFinding[]): Promise<DiscoveryEvent[]> {
        if (!findings.length) return [{ type: 'dropped', source }]
        return [{ type: 'found', source, findings: await resolveIcons(findings) }]
    }

    return {
        async fromExplore(event: ExploreEvent): Promise<DiscoveryEvent[]> {
            if (event.type === 'running') {
                started.add(event.id)
                return [{ type: 'pending', source: event.id }]
            }
            if (event.type === 'done') return found(event.id, findingsForCollector(event.id, event.output.data as CollectorData[typeof event.id], draft, domain))
            if ((event.type === 'skipped' || event.type === 'error') && started.has(event.id)) return [{ type: 'dropped', source: event.id }]
            return []
        },
        fromProfile(profile: SiteRead | null): Promise<DiscoveryEvent[]> {
            return found('profile', profile ? findingsForProfile(profile, draft, domain) : [])
        },
    }
}
