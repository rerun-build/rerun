import 'server-only'

import type { VaultItemSummary } from '@rerun/contracts'

import { AccessDeniedError, type Actor } from '@/app/api/_auth/access'
import { attachVaultItem, createVaultItem, getVaultItem, listVaultItems } from '@/lib/engine/vault-client'
import { getMethod, missingRequiredInputs, serviceManifestSchema } from '@/lib/services/manifest'
import { sanitizeIlike } from '@/lib/search/ilike'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { newServiceInstanceId } from '@/lib/services/instances'
import type { AuthMethodSummary } from '@/lib/services/types'
import { VAULT_METHOD_KINDS, compileIntoVault } from '@/lib/vault/install'
import { assertCanAdd, assertCanChangeItem, assertManagesCoworker, rethrowConflict, vaultContext } from './vault.service'
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
    if (!VAULT_METHOD_KINDS.has(method.kind)) throw new AccessDeniedError('vaultMethodUnsupported')

    const sameApp = (await listVaultItems(ctx.conn)).filter(item => item.slug === manifest.slug)
    const instanceId = manifest.multiInstance && sameApp.length > 0 ? newServiceInstanceId(sameApp.flatMap(item => item.instanceId ?? [])) : undefined
    const label = instanceId ? `${manifest.name} ${sameApp.length + 1}` : undefined
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
            ...(instanceId ? { instanceId, label } : {}),
            createdBy,
        })
    } else {
        const instance = instanceId ? { key: `${manifest.slug}@${instanceId}`, instanceId, label } : undefined
        item = (await rethrowConflict(ctx, () => compileIntoVault({ conn: ctx.conn, manifest, values, authMethodId: method.id, instance, createdBy }))).item
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
    if (!VAULT_METHOD_KINDS.has(method.kind)) throw new AccessDeniedError('vaultMethodUnsupported')
    if (missingRequiredInputs(method, values).length > 0) return { status: 'needs_config', item: current, authMethods: toAuthMethodSummaries(manifest), authMethodId: method.id }
    const instance = current.instanceId ? { key: `${current.slug}@${current.instanceId}`, instanceId: current.instanceId, label: current.label } : undefined
    const { item } = await rethrowConflict(ctx, () => compileIntoVault({ conn: ctx.conn, manifest, values, authMethodId: method.id, instance, itemId }))
    return resultOf(item, toAuthMethodSummaries(manifest))
}

export type VaultCatalogApp = { slug: string; name: string; icon: string | null; category: string; summary: string; multiInstance: boolean; authMethods: AuthMethodSummary[] }

const CATALOG_COLUMNS = ['slug', 'name', 'icon', 'category', 'summary', 'manifest'] as const

// The catalog as the Vault offers it: no coworker to read installs from, and only the sign-in methods
// the Vault holds. An app none of whose methods it holds is left out until it does.
export async function vaultCatalog(query?: string): Promise<VaultCatalogApp[]> {
    const supabase = createServiceRoleClient()
    const text = sanitizeIlike(query ?? '')
    const pattern = `%${text}%`
    const filters = text ? { enabled: true, or: { name: { ilike: pattern }, slug: { ilike: pattern } } } : { enabled: true }
    const { data } = await selectMany(supabase, 'services', CATALOG_COLUMNS, filters, { column: 'name' }, 60)
    return (data ?? []).flatMap(row => {
        const parsed = serviceManifestSchema.safeParse(row.manifest)
        if (!parsed.success) return []
        const authMethods = toAuthMethodSummaries(parsed.data).filter(method => VAULT_METHOD_KINDS.has(method.kind))
        if (authMethods.length === 0) return []
        return [{ slug: row.slug, name: row.name, icon: row.icon, category: row.category, summary: row.summary, multiInstance: parsed.data.multiInstance, authMethods }]
    })
}
