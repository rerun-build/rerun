import 'server-only'

import { type VaultItemSummary, type VaultSkill, vaultAccountLabel } from '@rerun/contracts'

import type { EngineConnection } from '@/lib/engine/types'
import { attachVaultItem, createVaultItem, getVaultItem, patchVaultItem, updateVaultItemEnv } from '@/lib/engine/vault-client'
import { type AccountRef, type CompileResult, compileServiceParts } from '@/lib/services/compiler'
import type { ServiceInstanceTarget } from '@/lib/services/instances'
import { type ServiceManifest, type ServiceSkill, getMethod, skillQuotesAccount } from '@/lib/services/manifest'
import { slugify } from '@/lib/slugify'

// What `${agent.id}` becomes in a Vault item: the engine resolves it to whichever coworker calls.
export const VAULT_AGENT_REF = '${RERUN_AGENT_ID}'

// The kinds of sign-in the Vault holds. Paid apps still install in the coworker's own folder: their
// accounts are the workspace's already, in Supabase.
export const VAULT_METHOD_KINDS: ReadonlySet<string> = new Set(['oauth', 'key', 'stdio', 'none', 'managed', 'composio'])

// What the Vault's own add page offers: a managed or Composio sign-in needs a coworker to start
// from for now, so those apps are added from a coworker's Apps tab and attached from the Vault.
export const VAULT_DIALOG_METHOD_KINDS: ReadonlySet<string> = new Set(['oauth', 'key', 'stdio', 'none'])

// The slug the engine would give the skill, so an item's skill lands where an install of the same
// app on the coworker itself would have put it.
export function vaultSkills(skills: ServiceSkill[]): VaultSkill[] {
    const seen = new Set<string>()
    const out: VaultSkill[] = []
    for (const skill of skills) {
        const slug = slugify(skill.name, { maxLength: 64 }) || 'skill'
        if (seen.has(slug) || !skill.body.trim()) continue
        seen.add(slug)
        out.push({ slug, name: skill.name, description: skill.description, body: skill.body })
    }
    return out
}

// The first account of an app is only spoken of by a name a person gave it: any other label on it is
// the box's own, like the coworker it came from.
function accountOf(item: Pick<VaultItemSummary, 'instanceId' | 'label' | 'customLabel'>): AccountRef {
    return item.instanceId ? { instanceId: item.instanceId, label: vaultAccountLabel(item) } : { label: item.customLabel }
}

// The skills of an account whose name or instance changed, or null when none of them speaks of it.
export function accountSkillsOf(manifest: ServiceManifest, item: Pick<VaultItemSummary, 'authMethodId' | 'config' | 'instanceId' | 'label' | 'customLabel' | 'skills'>): VaultSkill[] | null {
    const method = getMethod(manifest, item.authMethodId)
    if (item.skills.length === 0 || !manifest.skills.some(skill => skillQuotesAccount(skill, method))) return null
    return vaultSkills(compileServiceParts(manifest, item.config, method.id, VAULT_AGENT_REF, accountOf(item)).skills)
}

export type VaultInstall = {
    conn: EngineConnection
    manifest: ServiceManifest
    values: Record<string, string>
    authMethodId?: string
    instance?: ServiceInstanceTarget & { label?: string }
    // The item to compile again, or none to create one.
    itemId?: string | null
    // The coworker installing it, attached to the item; none when it is added from the Vault itself.
    engineAgentId?: string
    createdBy?: string | null
}

// The install of a catalog app as a Vault item: compiled once, without any coworker's id in it, and
// held on the box for every coworker attached to it.
export async function compileIntoVault(install: VaultInstall): Promise<CompileResult & { item: VaultItemSummary }> {
    const { conn, manifest, values, authMethodId, instance, itemId, engineAgentId } = install
    const current = itemId ? await getVaultItem(conn, itemId) : null
    const compiled = compileServiceParts(manifest, values, authMethodId, VAULT_AGENT_REF, current ? accountOf(current) : { instanceId: instance?.instanceId, label: instance?.label })
    const fields = {
        status: compiled.status,
        authMethodId: compiled.authMethodId,
        config: compiled.config,
        mcpServers: compiled.servers,
        skills: vaultSkills(compiled.skills),
    }
    // The account an entry is connected to survives a recompile, so that signing in again can replace it.
    const held = current?.composio?.toolkit === compiled.composio?.toolkit ? current?.composio : undefined
    const composio = compiled.composio && { ...held, ...compiled.composio }
    const targets = { oauth: compiled.oauth, managed: compiled.managed, composio, app: compiled.app }

    let item: VaultItemSummary
    if (itemId && current) {
        // A recompile only adds or replaces values: a secret left blank in the form keeps the one held.
        // Another sign-in method is another set of variables, and the old ones go.
        const stale = current.authMethodId !== compiled.authMethodId ? current.envKeys.filter(key => !(key in compiled.env)) : []
        if (Object.keys(compiled.env).length > 0 || stale.length > 0) await updateVaultItemEnv(conn, itemId, { set: compiled.env, remove: stale })
        item = await patchVaultItem(conn, itemId, { ...fields, ...targets })
        if (engineAgentId && !item.sharedWithAll && !item.agentIds.includes(engineAgentId)) item = await attachVaultItem(conn, itemId, engineAgentId)
    } else {
        item = await createVaultItem(conn, {
            kind: 'service',
            slug: manifest.slug,
            name: manifest.name,
            ...(instance?.label ? { label: instance.label } : {}),
            ...(instance ? { instanceId: instance.instanceId } : {}),
            ...fields,
            ...Object.fromEntries(Object.entries(targets).filter(([, target]) => target)),
            agentIds: engineAgentId ? [engineAgentId] : [],
            createdBy: install.createdBy ?? null,
            env: compiled.env,
        })
    }
    return { toolNames: compiled.toolNames, ...targets, composio: compiled.composio, item }
}
