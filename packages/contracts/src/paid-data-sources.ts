// Where the data a coworker bought comes from, as the chat and the tables show it. Treg names the
// route that served a call (`servedBy`, "<vendor>.<route>"): a vendor that owns its data is named,
// a scraper or reseller is not, the platform the data was read from is shown instead.
import { capabilityOfCall, isPaidDataCapability, isPaidDataTool, paidDataEntry, type PaidDataCapability, type PaidDataGroup } from './paid-data.js'
import { toolNameOf } from './chat-tool-name.js'
import { parseHubOutput } from './tool-output.js'

export type PaidSource = { id: string; name: string; domain: string | null; kind: 'origin' | 'vendor' | 'generic' }

type Brand = { name: string; domain: string }

// Vendors whose own database answers the call. Any other vendor (crawl4ai, tikhub, anyapi…) only
// fetches from a platform or resells another one, and is never shown.
const DATA_VENDORS: Record<string, Brand> = {
    aiark: { name: 'AI Ark', domain: 'ai-ark.com' },
    apollo: { name: 'Apollo', domain: 'apollo.io' },
    aviato: { name: 'Aviato', domain: 'aviato.co' },
    blitzapi: { name: 'BlitzAPI', domain: 'blitz-api.ai' },
    branddev: { name: 'Brand.dev', domain: 'brand.dev' },
    companyenrich: { name: 'CompanyEnrich', domain: 'companyenrich.com' },
    contactout: { name: 'ContactOut', domain: 'contactout.com' },
    dataforseo: { name: 'DataForSEO', domain: 'dataforseo.com' },
    dropleads: { name: 'Dropleads', domain: 'dropleads.io' },
    enrow: { name: 'Enrow', domain: 'enrow.io' },
    exa: { name: 'Exa', domain: 'exa.ai' },
    'fiber-ai': { name: 'Fiber AI', domain: 'fiber.ai' },
    findymail: { name: 'Findymail', domain: 'findymail.com' },
    hunter: { name: 'Hunter', domain: 'hunter.io' },
    icypeas: { name: 'Icypeas', domain: 'icypeas.com' },
    leadmagic: { name: 'LeadMagic', domain: 'leadmagic.io' },
    leadsforge: { name: 'Leadsforge', domain: 'leadsforge.ai' },
    lusha: { name: 'Lusha', domain: 'lusha.com' },
    moz: { name: 'Moz', domain: 'moz.com' },
    neverbounce: { name: 'NeverBounce', domain: 'neverbounce.com' },
    oceanio: { name: 'Ocean.io', domain: 'ocean.io' },
    orbisearch: { name: 'OrbiSearch', domain: 'orbisearch.com' },
    parallel: { name: 'Parallel', domain: 'parallel.ai' },
    predictleads: { name: 'PredictLeads', domain: 'predictleads.com' },
    prospeo: { name: 'Prospeo', domain: 'prospeo.io' },
    quickenrich: { name: 'QuickEnrich', domain: 'quickenrich.io' },
    seranking: { name: 'SE Ranking', domain: 'seranking.com' },
    sixtyfour: { name: 'Sixtyfour', domain: 'sixtyfour.ai' },
    theirstack: { name: 'TheirStack', domain: 'theirstack.com' },
    thecompaniesapi: { name: 'The Companies API', domain: 'thecompaniesapi.com' },
    tomba: { name: 'Tomba', domain: 'tomba.io' },
    trykitt: { name: 'Kitt', domain: 'trykitt.ai' },
    wiza: { name: 'Wiza', domain: 'wiza.co' },
    zerobounce: { name: 'ZeroBounce', domain: 'zerobounce.net' },
}

// Data read from a platform is shown under that platform, whoever fetched it.
const PLATFORM_ORIGINS: Partial<Record<PaidDataGroup, Brand>> = {
    search: { name: 'Google', domain: 'google.com' },
    linkedin: { name: 'LinkedIn', domain: 'linkedin.com' },
    tiktok: { name: 'TikTok', domain: 'tiktok.com' },
    instagram: { name: 'Instagram', domain: 'instagram.com' },
    x: { name: 'X', domain: 'x.com' },
    youtube: { name: 'YouTube', domain: 'youtube.com' },
    facebook: { name: 'Facebook', domain: 'facebook.com' },
    reddit: { name: 'Reddit', domain: 'reddit.com' },
}

const CAPABILITY_ORIGINS: Partial<Record<PaidDataCapability, Brand>> = {
    'google.serp.maps': { name: 'Google Maps', domain: 'maps.google.com' },
    'google.serp.local': { name: 'Google Maps', domain: 'maps.google.com' },
    'google.serp.news': { name: 'Google News', domain: 'news.google.com' },
    'ai-search.perplexity.answer': { name: 'Perplexity', domain: 'perplexity.ai' },
}

// Resellers whose whole catalog is read from one platform, whatever group the call belongs to.
const VENDOR_ORIGINS: Record<string, Brand> = {
    enrichlayer: { name: 'LinkedIn', domain: 'linkedin.com' },
}

const GENERIC_SOURCE: PaidSource = { id: 'generic', name: 'Data provider', domain: null, kind: 'generic' }

const vendorOf = (servedBy: string | null | undefined): string | null => servedBy?.split('.')[0]?.toLowerCase() || null

export function paidDataSourceOf(capability: PaidDataCapability, servedBy: string | null | undefined): PaidSource {
    const vendor = vendorOf(servedBy)
    const origin = CAPABILITY_ORIGINS[capability] ?? PLATFORM_ORIGINS[paidDataEntry(capability).group] ?? (vendor ? VENDOR_ORIGINS[vendor] : undefined)
    if (origin) return { id: `origin:${origin.domain}`, ...origin, kind: 'origin' }
    const brand = vendor ? DATA_VENDORS[vendor] : undefined
    return brand ? { id: `vendor:${vendor}`, ...brand, kind: 'vendor' } : GENERIC_SOURCE
}

// The same, for a call the engine names by its raw capability string (the provenance index).
export function paidDataSourceOfCall(capability: string, servedBy: string | null | undefined): PaidSource {
    return isPaidDataCapability(capability) ? paidDataSourceOf(capability, servedBy) : GENERIC_SOURCE
}

type PaidCallStatus = 'found' | 'nothing_found' | 'pending' | 'failed' | 'not_run'

// What one call bought, kept small enough to survive the history trimming a big answer.
export type PaidCallReceipt = { status: PaidCallStatus; servedBy: string | null; found: number; asked: number; verdict: string | null }

type PaidCallOutputLike = {
    status?: unknown
    servedBy?: unknown
    result?: { output?: Record<string, unknown> | null; verification?: { verdict?: unknown } | null; rows?: { asked?: unknown } | null } | null
    receipt?: PaidCallReceipt
}

const STATUSES = new Set<PaidCallStatus>(['found', 'nothing_found', 'pending', 'failed', 'not_run'])

const asText = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const positiveInt = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

function verdictOf(capability: PaidDataCapability, output: PaidCallOutputLike): string | null {
    if (capability === 'people.email.verify') return asText(output.result?.output?.status)?.toLowerCase() ?? null
    return asText(output.result?.verification?.verdict)?.toLowerCase() ?? null
}

// Null for an output that is not a paid data answer, or one the engine never ran.
export function paidCallReceipt(capability: PaidDataCapability, params: Record<string, unknown> | undefined, rawOutput: unknown): PaidCallReceipt | null {
    const output = parseHubOutput<PaidCallOutputLike>(rawOutput)
    if (!output || typeof output !== 'object') return null
    if (output.receipt) return output.receipt
    const status = output.status as PaidCallStatus
    if (!STATUSES.has(status)) return null

    const entry = paidDataEntry(capability)
    const servedBy = asText(output.servedBy)
    const verdict = verdictOf(capability, output)
    if (entry.unit === 'call') return { status, servedBy, found: status === 'found' ? 1 : 0, asked: 1, verdict }

    const items = output.result?.output?.[entry.missField]
    const found = status === 'found' && Array.isArray(items) ? items.length : 0
    const asked = positiveInt(output.result?.rows?.asked) ?? positiveInt(params?.limit) ?? Math.max(found, 10)
    return { status, servedBy, found: Math.min(found, asked), asked, verdict }
}

export type PaidSourceLine = { source: PaidSource; capability: PaidDataCapability; label: string; found: number; asked: number }

export type PaidTurnSources = {
    // Each source once, in the order the coworker first used it.
    sources: PaidSource[]
    lines: PaidSourceLine[]
    emails: { checked: number; valid: number }
}

type PartLike = { type: string; toolName?: string; state?: string; input?: unknown; output?: unknown }
type MessageLike = { id: string; role: string; parts: readonly PartLike[] }

// A call that was refused, failed or is still running bought nothing: only answered calls count.
const COUNTED: ReadonlySet<PaidCallStatus> = new Set(['found', 'nothing_found'])

type CountedCall = { capability: PaidDataCapability; receipt: PaidCallReceipt }

function countedCalls(parts: readonly PartLike[]): CountedCall[] {
    const calls: CountedCall[] = []
    for (const part of parts) {
        const toolName = toolNameOf(part)
        if (!isPaidDataTool(toolName) || part.output === undefined) continue
        const capability = capabilityOfCall(toolName, part.input)
        if (!capability) continue
        const params = (part.input as { params?: Record<string, unknown> } | null | undefined)?.params
        const receipt = paidCallReceipt(capability, params, part.output)
        if (receipt && COUNTED.has(receipt.status)) calls.push({ capability, receipt })
    }
    return calls
}

function sourcesOfParts(parts: readonly PartLike[]): PaidTurnSources | null {
    const calls = countedCalls(parts)
    // A miss names no provider: it counts against whoever served the same capability in the turn.
    const servedSource = new Map<PaidDataCapability, PaidSource>()
    for (const { capability, receipt } of calls) {
        if (receipt.servedBy && !servedSource.has(capability)) servedSource.set(capability, paidDataSourceOf(capability, receipt.servedBy))
    }
    const lines = new Map<string, PaidSourceLine>()
    const sources = new Map<string, PaidSource>()
    const emails = { checked: 0, valid: 0 }
    for (const { capability, receipt } of calls) {
        const source = receipt.servedBy ? paidDataSourceOf(capability, receipt.servedBy) : (servedSource.get(capability) ?? paidDataSourceOf(capability, null))
        if (!sources.has(source.id)) sources.set(source.id, source)
        const key = `${source.id}|${capability}`
        const entry = paidDataEntry(capability)
        const line = lines.get(key) ?? { source, capability, label: entry.label, found: 0, asked: 0 }
        lines.set(key, { ...line, found: line.found + receipt.found, asked: line.asked + receipt.asked })
        if (receipt.verdict) {
            emails.checked += 1
            if (receipt.verdict === 'valid') emails.valid += 1
        }
    }
    return sources.size ? { sources: [...sources.values()], lines: [...lines.values()], emails } : null
}

// The sources of each turn, keyed by the id of the turn's last assistant message: that is where the
// chat shows them. A turn is everything since a user message, one assistant message live, several
// once reloaded from the engine's history.
export function paidDataSourcesByTurn(messages: readonly MessageLike[]): Map<string, PaidTurnSources> {
    const byTurn = new Map<string, PaidTurnSources>()
    let turn: PartLike[] = []
    let lastAssistantId: string | null = null
    const close = () => {
        const sources = lastAssistantId ? sourcesOfParts(turn) : null
        if (sources && lastAssistantId) byTurn.set(lastAssistantId, sources)
        turn = []
        lastAssistantId = null
    }
    for (const message of messages) {
        if (message.role === 'user') {
            close()
            continue
        }
        if (message.role !== 'assistant') continue
        turn.push(...message.parts)
        lastAssistantId = message.id
    }
    close()
    return byTurn
}
