// No 'server-only': the emails sent from a Trigger.dev task ask for the brand of their workspace.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Brand } from '@rerun/contracts'

import type { Database } from '@/app/api/database.types'
import { organizationDefaultOrigin, organizationOrigin } from '@/lib/brand/host'
import { organizationRootDomain } from '@/lib/brand/root-domain'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>

const BRAND_COLUMNS = ['id', 'name', 'slug', 'status', 'icon_url', 'color', 'support_email', 'docs_url', 'terms_url', 'privacy_url'] as const

type BrandRow = Pick<Database['public']['Tables']['organizations']['Row'], (typeof BRAND_COLUMNS)[number]>

// `hostname` is the domain of theirs being served, if any.
export function organizationBrand(row: Omit<BrandRow, 'status'>, hostname: string | null = null): Brand {
    return {
        organizationId: row.id,
        name: row.name,
        iconUrl: row.icon_url,
        color: row.color,
        supportEmail: row.support_email,
        appUrl: organizationOrigin(row.slug, hostname),
        links: { docs: row.docs_url, terms: row.terms_url, privacy: row.privacy_url },
    }
}

export async function brandOfOrganization(supabase: Client, row: Omit<BrandRow, 'status'>): Promise<Brand> {
    return organizationBrand(row, organizationDefaultOrigin(row.slug) ? await readServedHostname(supabase, row.id) : null)
}

// The first domain they had served keeps being the one they are reached at.
async function readServedHostname(supabase: Client, organizationId: string): Promise<string | null> {
    const { data, error } = await selectMany(supabase, 'organization_domains', ['hostname'] as const, { organization_id: organizationId, status: 'active' }, { column: 'created_at', ascending: true }, 1)
    if (error) throw new Error(`Could not read the domain of organization ${organizationId}: ${error.message}`)
    return data?.[0]?.hostname ?? null
}

// Asked for by every request, email, push, published page and coworker tool, and changed a few times
// in an organization's life: kept for a moment, in this process only.
const KEPT_MS = 30_000
const MAX_KEPT = 5_000

function keeper<Key, Value>(read: (key: Key) => Promise<Value>) {
    const kept = new Map<Key, { value: Value; until: number }>()
    return {
        forget: () => kept.clear(),
        get: async (key: Key): Promise<Value> => {
            const known = kept.get(key)
            if (known && known.until > Date.now()) return known.value
            const value = await read(key)
            if (kept.size >= MAX_KEPT) kept.clear()
            kept.set(key, { value, until: Date.now() + KEPT_MS })
            return value
        },
    }
}

type Address = { kind: 'organization'; slug: string } | { kind: 'domain'; hostname: string }
export type HostedOrganization = { brand: Brand; organizationId: string; suspended: boolean }

const brandsOfWorkspaces = keeper(readBrandOfWorkspace)
const organizationsOfHosts = keeper(readOrganizationOfHost)

// Its team just changed what it shows or where it is served. The other processes follow within the
// half minute.
export function forgetOrganizationBrands(): void {
    brandsOfWorkspaces.forget()
    organizationsOfHosts.forget()
}

// Null for a workspace that answers to Rerun itself. A read that failed throws: taken for "no
// organization", it would send a client an email in Rerun's name.
export async function organizationBrandOfWorkspace(workspaceId: number): Promise<Brand | null> {
    return brandsOfWorkspaces.get(workspaceId)
}

async function readBrandOfWorkspace(workspaceId: number): Promise<Brand | null> {
    const supabase = createServiceRoleClient()
    const { data: workspace, error } = await selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: workspaceId })
    if (error) throw new Error(`Could not read the organization of workspace ${workspaceId}: ${error.message}`)
    return workspace?.organization_id ? readBrand(supabase, workspace.organization_id) : null
}

async function readBrand(supabase: Client, organizationId: string): Promise<Brand> {
    const { data: organization, error } = await selectMaybeSingle(supabase, 'organizations', BRAND_COLUMNS, { id: organizationId })
    if (error || !organization) throw new Error(`Could not read organization ${organizationId}: ${error?.message ?? 'no row'}`)
    return brandOfOrganization(supabase, organization)
}

// Null for an address no organization has: never claimed, or not proven to be theirs.
export async function organizationOfHost(address: Address): Promise<HostedOrganization | null> {
    return organizationsOfHosts.get(address.kind === 'organization' ? `slug:${address.slug}` : `domain:${address.hostname}`)
}

async function readOrganizationOfHost(key: string): Promise<HostedOrganization | null> {
    const supabase = createServiceRoleClient()
    const [kind, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    const filter = kind === 'slug' ? { slug: name } : await ownerOfDomain(supabase, name)
    if (!filter) return null
    const { data: organization, error } = await selectMaybeSingle(supabase, 'organizations', BRAND_COLUMNS, filter)
    if (error) throw new Error(`Could not read the organization of ${name}: ${error.message}`)
    return organization && { brand: await brandOfOrganization(supabase, organization), organizationId: organization.id, suspended: organization.status !== 'active' }
}

async function ownerOfDomain(supabase: Client, hostname: string): Promise<{ id: string } | null> {
    const { data, error } = await selectMaybeSingle(supabase, 'organization_domains', ['organization_id'] as const, { hostname, status: 'active' })
    if (error) throw new Error(`Could not read the owner of ${hostname}: ${error.message}`)
    return data && { id: data.organization_id }
}

// Where third parties call a workspace for years (a trigger's URL): the default address, which a
// domain that comes and goes never breaks.
export async function organizationDefaultUrlOfWorkspace(workspaceId: number): Promise<string | null> {
    if (!organizationRootDomain()) return null
    const brand = await organizationBrandOfWorkspace(workspaceId)
    if (!brand?.organizationId) return null
    const { data, error } = await selectMaybeSingle(createServiceRoleClient(), 'organizations', ['slug'] as const, { id: brand.organizationId })
    if (error) throw new Error(error.message)
    return data && organizationDefaultOrigin(data.slug)
}

// The organization an account deals with, when it deals with a single one and with Rerun nowhere: the
// workspaces it works in, else the invitations that wait for it. The team of an organization is not
// its client.
export async function organizationBrandOfAccount({ userId, email }: { userId: string | null; email: string }): Promise<Brand | null> {
    const supabase = createServiceRoleClient()
    const organizations = (userId && (await organizationsJoined(supabase, userId))) || (await organizationsInviting(supabase, email))
    const [only, ...others] = new Set(organizations)
    return only && others.length === 0 ? readBrand(supabase, only) : null
}

async function organizationsOf(supabase: Client, workspaceIds: number[]): Promise<(string | null)[]> {
    if (workspaceIds.length === 0) return []
    const { data, error } = await selectMany(supabase, 'workspaces', ['organization_id'] as const, { id: workspaceIds })
    if (error) throw new Error(error.message)
    return (data ?? []).map(workspace => workspace.organization_id)
}

async function organizationsJoined(supabase: Client, userId: string): Promise<(string | null)[] | null> {
    const { data, error } = await selectMany(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId, organization_staff: false })
    if (error) throw new Error(error.message)
    return data?.length ? organizationsOf(supabase, data.map(row => row.workspace_id)) : null
}

async function organizationsInviting(supabase: Client, email: string): Promise<(string | null)[]> {
    const { data, error } = await selectMany(supabase, 'workspace_invitations', ['workspace_id'] as const, { email: email.toLowerCase(), status: 'pending' })
    if (error) throw new Error(error.message)
    return organizationsOf(supabase, (data ?? []).map(row => row.workspace_id))
}
