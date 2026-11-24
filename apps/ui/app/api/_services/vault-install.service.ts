import 'server-only'

import { paidAppFlags } from '@rerun/cloud/apps.server'
import type { SecretVaultTarget, VaultItemSummary } from '@rerun/contracts'

import { AccessDeniedError, type Actor } from '@/app/api/_auth/access'
import { appInfo } from '@/lib/apps/catalog'
import { APP_SLUGS, isAppSlug, type AppSlug } from '@/lib/apps/types'
import { attachVaultItem, createVaultItem, getVaultItem, listVaultItems, updateVaultItemEnv } from '@/lib/engine/vault-client'
import { appTarget, getMethod, missingRequiredInputs, serviceManifestSchema, takesSeveralAccounts } from '@/lib/services/manifest'
import { sanitizeIlike } from '@/lib/search/ilike'
import { slugify } from '@/lib/slugify'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectMany } from '@/supabase/supabase-helpers'
import { nextServiceInstance } from '@/lib/services/instances'
import type { AuthMethodSummary } from '@/lib/services/types'
import { VAULT_DIALOG_METHOD_KINDS, compileIntoVault } from '@/lib/vault/install'
import { assertCanAdd, assertCanChangeItem, assertManagesCoworker, requireAdmin, rethrowConflict, vaultContext } from './vault.service'
import { loadManifest, toAuthMethodSummaries } from './services.service'

export type VaultAddResult =
    | { status: 'installed'; item: VaultItemSummary }
    | { status: 'needs_config'; item: VaultItemSummary; authMethods: AuthMethodSummary[]; authMethodId: string }
    | { status: 'needs_auth'; item: VaultItemSummary; oauth: { serverName: string; url: string } }

export type AddVaultServiceInput = {
    slug: string
    values?: Record<string, string>
    authMethodId?: string
    // The hub's ids of the coworkers to attach it to; none leaves it in the Vault for later.
    agentIds?: string[]
}

function resultOf(item: VaultItemSummary, manifestMethods: AuthMethodSummary[]): VaultAddResult {
    if (item.status === 'needs_config') return { status: 'needs_config', item, authMethods: manifestMethods, authMethodId: item.authMethodId ?? '' }
    if (item.status === 'needs_auth' && item.oauth) return { status: 'needs_auth', item, oauth: item.oauth }
    return { status: 'installed', item }
}

// A catalog app added from the Vault itself: compiled once, signed in once, then attached to the
// coworkers picked. A second account of an app that takes several gets its own instance, so both can
// sit on one coworker; any other app can be added twice, for different coworkers.
export async function addVaultService(input: AddVaultServiceInput, actor?: Actor): Promise<VaultAddResult> {
    const ctx = await vaultContext(actor)
    await assertCanAdd(ctx.actor)
    const coworkers = await Promise.all((input.agentIds ?? []).map(id => assertManagesCoworker(ctx.actor, ctx.coworkers.find(c => c.id === id))))
    const manifest = await loadManifest(input.slug)
    if (!manifest) throw new Error(`Service not found: ${input.slug}`)
    const method = getMethod(manifest, input.authMethodId)
    if (!VAULT_DIALOG_METHOD_KINDS.has(method.kind)) throw new AccessDeniedError('vaultMethodUnsupported')

    const sameApp = (await listVaultItems(ctx.conn)).filter(item => item.slug === manifest.slug)
    const instance = sameApp.length > 0 ? nextServiceInstance(manifest, sameApp) : null
    const createdBy = ctx.actor.kind === 'user' ? ctx.actor.userId : null
    const values = input.values ?? {}

    let item: VaultItemSummary
    if (missingRequiredInputs(method, values).length > 0) {
        item = await createVaultItem(ctx.conn, {
            kind: 'service',
            slug: manifest.slug,
            name: manifest.name,
            status: 'needs_config',
            authMethodId: method.id,
            ...(instance ? { instanceId: instance.instanceId, label: instance.label } : {}),
            createdBy,
        })
    } else {
        item = (await rethrowConflict(ctx, () => compileIntoVault({ conn: ctx.conn, manifest, values, authMethodId: method.id, instance: instance ?? undefined, createdBy }))).item
    }
    for (const coworker of coworkers) item = await rethrowConflict(ctx, () => attachVaultItem(ctx.conn, item.id, coworker.engineAgentId))
    return resultOf(item, toAuthMethodSummaries(manifest))
}

// The install form of an entry submitted again: new values, another sign-in method. It changes the
// entry for every coworker using it.
export async function reconfigureVaultService(itemId: string, values: Record<string, string>, authMethodId: string | undefined, actor?: Actor): Promise<VaultAddResult> {
    const ctx = await vaultContext(actor)
    const current = await getVaultItem(ctx.conn, itemId)
    await assertCanChangeItem(ctx.actor, current, ctx)
    if (!current.slug) throw new Error('Only a catalog app is configured through its install form')
    const manifest = await loadManifest(current.slug)
    if (!manifest) throw new Error(`Service not found: ${current.slug}`)
    const method = getMethod(manifest, authMethodId ?? current.authMethodId)
    if (!VAULT_DIALOG_METHOD_KINDS.has(method.kind)) throw new AccessDeniedError('vaultMethodUnsupported')
    if (missingRequiredInputs(method, values).length > 0) return { status: 'needs_config', item: current, authMethods: toAuthMethodSummaries(manifest), authMethodId: method.id }
    const instance = current.instanceId ? { key: `${current.slug}@${current.instanceId}`, instanceId: current.instanceId, label: current.label } : undefined
    const { item } = await rethrowConflict(ctx, () => compileIntoVault({ conn: ctx.conn, manifest, values, authMethodId: method.id, instance, itemId }))
    return resultOf(item, toAuthMethodSummaries(manifest))
}

// `paidApp`: a paid app (LinkedIn Pro, WhatsApp Pro), connected in its own window rather than in the Vault's form.
export type VaultCatalogApp = { slug: string; name: string; icon: string | null; category: string; summary: string; multiInstance: boolean; authMethods: AuthMethodSummary[]; paidApp?: AppSlug }

const CATALOG_COLUMNS = ['slug', 'name', 'icon', 'category', 'summary', 'manifest'] as const

type CatalogRow = { slug: string; name: string; icon: string | null; category: string; summary: string; manifest: unknown }

// The catalog as the Vault offers it: no coworker to read installs from, and only the sign-in methods
// the Vault holds, plus the paid apps the plan sells. Any other app is left out until the Vault holds its sign-in.
function toVaultCatalogApps(rows: CatalogRow[], paidApps: Set<AppSlug>): VaultCatalogApp[] {
    return rows.flatMap(row => {
        const parsed = serviceManifestSchema.safeParse(row.manifest)
        if (!parsed.success) return []
        const app = { slug: row.slug, name: row.name, icon: row.icon, category: row.category, summary: row.summary, multiInstance: takesSeveralAccounts(parsed.data) }
        const paidApp = parsed.data.authMethods.map(method => appTarget(method)?.appSlug).find(isAppSlug)
        if (paidApp) return paidApps.has(paidApp) ? [{ ...app, authMethods: [], paidApp }] : []
        const authMethods = toAuthMethodSummaries(parsed.data).filter(method => VAULT_DIALOG_METHOD_KINDS.has(method.kind))
        if (authMethods.length === 0) return []
        return [{ ...app, authMethods }]
    })
}

export async function vaultCatalog(query?: string): Promise<VaultCatalogApp[]> {
    const supabase = createServiceRoleClient()
    const text = sanitizeIlike(query ?? '')
    const pattern = `%${text}%`
    const filters = text ? { enabled: true, or: { name: { ilike: pattern }, slug: { ilike: pattern } } } : { enabled: true }
    const flags = await paidAppFlags()
    const paidApps = APP_SLUGS.filter(slug => flags[slug])
    // Browsed without a query, the paid apps are read on their own and come first, ahead of the catalog by name.
    const pinnedSlugs = text ? [] : paidApps.map(slug => appInfo(slug).serviceSlug)
    const [{ data: page }, { data: pinned }] = await Promise.all([
        selectAll(supabase, 'services', CATALOG_COLUMNS, filters, { column: 'name' }),
        pinnedSlugs.length ? selectMany(supabase, 'services', CATALOG_COLUMNS, { enabled: true, slug: pinnedSlugs }) : Promise.resolve({ data: [] }),
    ])
    const rows = [...(pinned ?? []), ...(page ?? []).filter(row => !pinnedSlugs.includes(row.slug))]
    return toVaultCatalogApps(rows, new Set(paidApps))
}

// What an empty Vault offers first. The catalog is sorted by name, so its own first apps would be
// whatever starts with an A.
const VAULT_POPULAR_SLUGS = ['notion', 'slack', 'hubspot', 'linear', 'github', 'airtable']

export async function vaultPopularApps(): Promise<VaultCatalogApp[]> {
    const { data } = await selectMany(createServiceRoleClient(), 'services', CATALOG_COLUMNS, { enabled: true, slug: VAULT_POPULAR_SLUGS })
    const apps = toVaultCatalogApps(data ?? [], new Set())
    return VAULT_POPULAR_SLUGS.flatMap(slug => apps.filter(app => app.slug === slug))
}

export type AddVaultSecretInput = { name: string; key: string; value: string; agentIds?: string[] }

// A free secret: one variable, read by the attached coworkers in their shell. Its value is never
// shown again.
export async function addVaultSecret(input: AddVaultSecretInput, actor?: Actor): Promise<VaultItemSummary> {
    return addVaultSecrets({ name: input.name, env: { [input.key.trim()]: input.value }, agentIds: input.agentIds }, actor)
}

async function addVaultSecrets(input: { name: string; env: Record<string, string>; agentIds?: string[]; sharedWithAll?: boolean }, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    await assertCanAdd(ctx.actor)
    if (input.sharedWithAll) requireAdmin(ctx.actor)
    const coworkers = await Promise.all((input.agentIds ?? []).map(id => assertManagesCoworker(ctx.actor, ctx.coworkers.find(c => c.id === id))))
    const createdBy = ctx.actor.kind === 'user' ? ctx.actor.userId : null
    return rethrowConflict(ctx, () =>
        createVaultItem(ctx.conn, {
            kind: 'secret',
            name: input.name,
            env: input.env,
            agentIds: coworkers.map(c => c.engineAgentId),
            ...(input.sharedWithAll ? { sharedWithAll: true } : {}),
            createdBy,
        }),
    )
}

// The model never reads the names of an entry's variables, so a key it asks to replace is matched by
// name when the entry has it, or taken as the one key of an entry that holds a single one.
async function replaceVaultKeys(entryId: string, values: Record<string, string>, actor: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const current = await getVaultItem(ctx.conn, entryId)
    await assertCanChangeItem(ctx.actor, current, ctx)
    if (current.kind === 'service') throw new AccessDeniedError('vaultKeysUnknown')
    const keys = Object.keys(values)
    const known = keys.every(key => current.envKeys.includes(key))
    const single = !known && keys.length === 1 && current.envKeys.length === 1
    if (!known && !single) throw new AccessDeniedError('vaultKeysUnknown')
    await updateVaultItemEnv(ctx.conn, entryId, { set: single ? { [current.envKeys[0]]: values[keys[0]] } : values })
    return getVaultItem(ctx.conn, entryId)
}

// What the Chief of Staff's form typed, sent where it asked, with the rights of the person who typed
// it: the keys of an entry replaced, a custom MCP server whose headers they fill, or a new secret.
// The share goes in with the creation, never after it: a refusal leaves the form answerable, so an
// entry already kept would come back as a duplicate on the next try.
export async function saveSecretsToVault(target: SecretVaultTarget, values: Record<string, string>, actor: Actor): Promise<VaultItemSummary> {
    if (target.entryId) return replaceVaultKeys(target.entryId, values, actor)
    const { agentIds, sharedWithAll, mcpServer: server } = target
    if (server && (server.headers.some(({ key }) => !values[key]) || Object.keys(values).some(key => !server.headers.some(header => header.key === key)))) throw new AccessDeniedError('vaultHeaderValueMissing')
    if (!server) return addVaultSecrets({ name: target.name ?? Object.keys(values).join(', '), env: values, agentIds, sharedWithAll }, actor)
    const headers = server.headers.map(({ header, key, prefix }) => ({ name: header, value: prefix ? `${prefix.trim()} ${values[key]}` : values[key] }))
    return addVaultMcp({ name: target.name ?? 'MCP server', url: server.url, headers, agentIds, sharedWithAll }, actor)
}

export type AddVaultMcpInput = {
    name: string
    // A remote server, or a command the box starts.
    url?: string
    // Left out, the engine reads it from the address (`/sse` or not).
    transport?: 'sse' | 'http'
    command?: string
    args?: string[]
    // Headers and environment variables whose values are secrets: kept in the entry's `.env`, the
    // server only names them.
    headers?: Array<{ name: string; value: string }>
    env?: Array<{ name: string; value: string }>
    agentIds?: string[]
    // Admins only.
    sharedWithAll?: boolean
}

const SERVER_NAME_MAX = 64

// The server name the model sees its tools under: `<name>_<tool>`.
export function vaultServerName(name: string): string {
    return slugify(name, { maxLength: SERVER_NAME_MAX }) || 'mcp'
}

function entryVariable(server: string, key: string): string {
    return `VAULT_${server}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 120)
}

// A custom MCP server: its secret headers go to the entry's `.env`, and a remote one with no key of
// its own is offered a browser sign-in, which the server may or may not ask for.
export async function addVaultMcp(input: AddVaultMcpInput, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    await assertCanAdd(ctx.actor)
    if (input.sharedWithAll) requireAdmin(ctx.actor)
    const coworkers = await Promise.all((input.agentIds ?? []).map(id => assertManagesCoworker(ctx.actor, ctx.coworkers.find(c => c.id === id))))
    const url = input.url?.trim()
    const command = input.command?.trim()
    if (!url === !command) throw new AccessDeniedError('vaultMcpTarget')
    const serverName = vaultServerName(input.name)
    const env: Record<string, string> = {}
    const toVariables = (pairs: Array<{ name: string; value: string }> = []) => {
        const refs: Record<string, string> = {}
        for (const { name, value } of pairs) {
            if (!name.trim() || !value) continue
            const variable = entryVariable(serverName, name)
            env[variable] = value
            refs[name.trim()] = `\${${variable}}`
        }
        return refs
    }
    const headers = toVariables(input.headers)
    const serverEnv = toVariables(input.env)
    const server = { name: serverName, ...(url ? { url, ...(input.transport ? { transport: input.transport } : {}) } : { command, args: input.args ?? [] }), headers, ...(Object.keys(serverEnv).length > 0 ? { env: serverEnv } : {}) }
    const createdBy = ctx.actor.kind === 'user' ? ctx.actor.userId : null
    return rethrowConflict(ctx, () =>
        createVaultItem(ctx.conn, {
            kind: 'mcp',
            name: input.name,
            mcpServers: [server],
            ...(url && Object.keys(headers).length === 0 ? { oauth: { serverName, url } } : {}),
            env,
            agentIds: coworkers.map(c => c.engineAgentId),
            ...(input.sharedWithAll ? { sharedWithAll: true } : {}),
            createdBy,
        }),
    )
}
