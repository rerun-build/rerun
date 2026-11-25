// No 'server-only': the hourly check is a Trigger.dev task.
import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { publicDns, readDomain, verificationName, type DnsResolver } from '@/ee/lib/organizations/domain-dns'
import { nextDomainState, toDomainProblem, toDomainStatus, type DomainProblem, type DomainStatus } from '@/ee/lib/organizations/domain-state'
import { isReservedHostname, normalizeHostname } from '@/ee/lib/organizations/hostname'
import { forgetOrganizationBrands, organizationOfHost } from '@/ee/services/organization-brand.service'
import type { OrganizationContext } from '@/ee/services/organization-context.service'
import { canonicalHostname, classifyHost, edgeHostname, organizationDefaultHostname } from '@/lib/brand/host'
import { organizationRootDomain } from '@/lib/brand/root-domain'
import { AppError } from '@/lib/i18n/action-error'
import { publishHostname } from '@/lib/published/host'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type DomainInsert = Database['public']['Tables']['organization_domains']['Insert']
type DomainUpdate = Database['public']['Tables']['organization_domains']['Update']

const DOMAIN_COLUMNS = ['id', 'organization_id', 'hostname', 'status', 'verification_token', 'problem', 'failing_since', 'verified_at', 'last_checked_at', 'created_at'] as const

type DomainRow = Pick<Database['public']['Tables']['organization_domains']['Row'], (typeof DOMAIN_COLUMNS)[number]>

const UNIQUE_VIOLATION = '23505'
export const MAX_DOMAINS = 10
// A click does not ask the DNS again this soon.
const CHECK_PACE_MS = 5_000
// A domain nobody finished setting up is no longer looked at on its own.
const PENDING_CHECKED_FOR_MS = 7 * 24 * 60 * 60 * 1000

export type DomainRecord = { type: 'CNAME' | 'TXT'; name: string; value: string }
export type OrganizationDomain = { id: string; hostname: string; status: DomainStatus; problem: DomainProblem | null; records: DomainRecord[]; lastCheckedAt: string | null }
export type OrganizationDomains = { defaultHostname: string | null; domains: OrganizationDomain[] }

function requireEdge(): string {
    const edge = edgeHostname()
    if (!edge) throw new AppError('domainsUnavailable')
    return edge
}

function viewOf(row: DomainRow): OrganizationDomain {
    const edge = edgeHostname()
    return {
        id: row.id,
        hostname: row.hostname,
        status: toDomainStatus(row.status),
        problem: toDomainProblem(row.problem),
        records: edge
            ? [
                  { type: 'CNAME', name: row.hostname, value: edge },
                  { type: 'TXT', name: verificationName(row.hostname), value: row.verification_token },
              ]
            : [],
        lastCheckedAt: row.last_checked_at,
    }
}

export async function listOrganizationDomains({ supabase, organization }: OrganizationContext): Promise<OrganizationDomains> {
    const { data, error } = await selectAll(supabase, 'organization_domains', DOMAIN_COLUMNS, { organization_id: organization.id }, { column: 'created_at', ascending: true })
    if (error) throw new Error(error.message)
    return { defaultHostname: organizationDefaultHostname(organization.slug), domains: data.map(viewOf) }
}

export async function addOrganizationDomain({ supabase, organization }: OrganizationContext, rawHostname: string): Promise<void> {
    requireEdge()
    const hostname = normalizeHostname(rawHostname)
    if (!hostname) throw new AppError('domainInvalid')
    if (isReservedHostname(hostname, [organizationRootDomain(), publishHostname(), canonicalHostname()])) throw new AppError('domainReserved')

    const { data: served, error: servedError } = await selectMaybeSingle(supabase, 'organization_domains', ['organization_id'] as const, { hostname, status: 'active' })
    if (servedError) throw new Error(servedError.message)
    if (served && served.organization_id !== organization.id) throw new AppError('domainTaken')

    const { data: count, error: countError } = await selectCount(supabase, 'organization_domains', { organization_id: organization.id })
    if (countError) throw new Error(countError.message)
    if ((count ?? 0) >= MAX_DOMAINS) throw new AppError('domainLimit', { max: MAX_DOMAINS })

    const { error } = await supabase
        .from('organization_domains')
        .insert<DomainInsert>({ organization_id: organization.id, hostname, status: 'pending', verification_token: `verify-${randomBytes(20).toString('hex')}` })
    if (error?.code === UNIQUE_VIOLATION) throw new AppError('domainAlreadyAdded')
    if (error) throw new Error(error.message)
}

// Another organization's domain answers like one that does not exist.
async function requireDomain({ supabase, organization }: OrganizationContext, domainId: string): Promise<DomainRow> {
    const { data, error } = await selectMaybeSingle(supabase, 'organization_domains', DOMAIN_COLUMNS, { id: domainId, organization_id: organization.id })
    if (error) throw new Error(error.message)
    if (!data) throw new AppError('domainNotFound')
    return data
}

export async function removeOrganizationDomain(ctx: OrganizationContext, domainId: string): Promise<void> {
    await requireDomain(ctx, domainId)
    const { error } = await ctx.supabase.from('organization_domains').delete().eq('id', domainId).eq('organization_id', ctx.organization.id)
    if (error) throw new Error(error.message)
    forgetOrganizationBrands()
}

export async function checkOrganizationDomain(ctx: OrganizationContext, domainId: string, dns: DnsResolver = publicDns()): Promise<void> {
    const row = await requireDomain(ctx, domainId)
    if (row.last_checked_at && Date.now() - Date.parse(row.last_checked_at) < CHECK_PACE_MS) return
    await checkDomain(ctx.supabase, row, dns)
}

// Written only over the state that was read: of two checks at once, the later one decides nothing on
// what the first just changed. `error` from the unique index of the active ones: another organization
// proved it first.
async function checkDomain(supabase: Client, row: DomainRow, dns: DnsResolver): Promise<DomainStatus> {
    const now = new Date()
    const status = toDomainStatus(row.status)
    const reading = await readDomain(dns, { hostname: row.hostname, token: row.verification_token, edge: requireEdge() })
    const next = nextDomainState({ status, failing_since: row.failing_since }, reading, now)
    const activated = next.status === 'active' && status !== 'active'

    const write = (update: DomainUpdate) => supabase.from('organization_domains').update<DomainUpdate>({ ...update, last_checked_at: now.toISOString() }).eq('id', row.id).eq('status', row.status)
    const { error } = await write({ ...next, ...(activated ? { verified_at: now.toISOString() } : {}) })
    if (error?.code === UNIQUE_VIOLATION) {
        const { error: takenError } = await write({ problem: 'taken' })
        if (takenError) throw new Error(takenError.message)
        return status
    }
    if (error) throw new Error(error.message)
    if (next.status !== status) forgetOrganizationBrands()
    return next.status
}

export type DomainSweep = { checked: number; activated: string[]; lost: string[]; failed: string[] }

// Every domain being served, and the recent ones still waiting for their records.
export async function checkOrganizationDomains(supabase: Client, dns: DnsResolver = publicDns()): Promise<DomainSweep> {
    const [served, waiting] = await Promise.all([
        selectAll(supabase, 'organization_domains', DOMAIN_COLUMNS, { status: 'active' }, { column: 'created_at', ascending: true }),
        selectAll(supabase, 'organization_domains', DOMAIN_COLUMNS, { status: ['pending', 'error'], created_at: { gte: new Date(Date.now() - PENDING_CHECKED_FOR_MS).toISOString() } }, { column: 'created_at', ascending: true }),
    ])
    const error = served.error ?? waiting.error
    if (error) throw new Error(error.message)

    const sweep: DomainSweep = { checked: 0, activated: [], lost: [], failed: [] }
    for (const row of [...(served.data ?? []), ...(waiting.data ?? [])]) {
        try {
            const status = await checkDomain(supabase, row, dns)
            sweep.checked++
            if (status === 'active' && row.status !== 'active') sweep.activated.push(row.hostname)
            if (status === 'error' && row.status === 'active') sweep.lost.push(row.hostname)
        } catch (err) {
            sweep.failed.push(`${row.hostname}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    return sweep
}

// The names the edge may get a certificate for: the default address of every organization, and the
// domains they proved. A suspended organization keeps its certificate, for the page that says so.
export async function isServedHostname(hostname: string): Promise<boolean> {
    if (normalizeHostname(hostname) !== hostname) return false
    const address = classifyHost(hostname)
    if (address.kind !== 'organization' && address.kind !== 'domain') return false
    return (await organizationOfHost(address)) !== null
}
