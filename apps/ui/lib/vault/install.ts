import 'server-only'

import type { VaultItemSummary, VaultSkill } from '@rerun/contracts'

import type { EngineConnection } from '@/lib/engine/types'
import { attachVaultItem, createVaultItem, getVaultItem, patchVaultItem, updateVaultItemEnv } from '@/lib/engine/vault-client'
import { type CompileResult, type ServiceInstanceTarget, compileServiceParts } from '@/lib/services/compiler'
import type { ServiceManifest, ServiceSkill } from '@/lib/services/manifest'
import { slugify } from '@/lib/slugify'

// What `${agent.id}` becomes in a Vault item: the engine resolves it to whichever coworker calls.
export const VAULT_AGENT_REF = '${RERUN_AGENT_ID}'

// The kinds of sign-in the Vault holds so far. Managed apps, Composio and paid apps still install in
// the coworker's own folder until the Vault carries their accounts too.
export const VAULT_METHOD_KINDS: ReadonlySet<string> = new Set(['oauth', 'key', 'stdio', 'none'])

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
    const compiled = compileServiceParts(manifest, values, authMethodId, VAULT_AGENT_REF, instance?.instanceId)
    const fields = {
        status: compiled.status,
        authMethodId: compiled.authMethodId,
        config: compiled.config,
        mcpServers: compiled.servers,
        skills: vaultSkills(compiled.skills),
    }
    const targets = { oauth: compiled.oauth, managed: compiled.managed, composio: compiled.composio, app: compiled.app }

    let item: VaultItemSummary
    if (itemId) {
        // A recompile only adds or replaces values: a secret left blank in the form keeps the one held.
        // Another sign-in method is another set of variables, and the old ones go.
        const current = await getVaultItem(conn, itemId)
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
    return { toolNames: compiled.toolNames, ...targets, item }
}
