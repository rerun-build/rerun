import type { Actor } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { createSkill, deleteMcpToken, deleteSkill, listSkills, patchMcpServers, updateAgentKeys, updateSkill } from '@/lib/engine/client'
import type { EngineConnection, EngineMcpServer } from '@/lib/engine/types'
import type { InputDef, McpServerTemplate, ServiceManifest, ServiceSkill } from './manifest'
import { deleteConnectedAccount } from '@/lib/composio/client'
import { defaultInstanceEnvVar, instanceEnvVar, instanceServerName, ordinalInstanceLabel } from './instances'
import { appTarget, composioTarget, getMethod, managedTarget, oauthServer } from './manifest'
import { type RegistryEntry, readRegistry, registryFootprint, upsertRegistryEntry } from './registry'

type SubstituteContext = {
    values: Record<string, string>
    inputMap: Map<string, InputDef>
    varNameFor: (inputKey: string) => string
    referencedSecrets: Set<string>
    derivedSecrets: Record<string, string>
    engineAgentId: string
}

const BASIC_PLACEHOLDER = /\$\{basic:input\.([A-Za-z0-9_]+):input\.([A-Za-z0-9_]+)\}/g

function substituteBasic(value: string, ctx: SubstituteContext): string {
    return value.replace(BASIC_PLACEHOLDER, (_, userKey: string, passwordKey: string) => {
        const user = ctx.values[userKey]
        const password = ctx.values[passwordKey]
        if (!user || !password) return ''
        const varName = ctx.varNameFor(`${userKey}_${passwordKey}_BASIC`)
        ctx.derivedSecrets[varName] = Buffer.from(`${user}:${password}`).toString('base64')
        return `\${${varName}}`
    })
}

function substitute(value: string, ctx: SubstituteContext): string {
    return substituteBasic(value, ctx).replaceAll('${agent.id}', ctx.engineAgentId).replace(/\$\{input\.([A-Za-z0-9_]+)\}/g, (_, key) => {
        if (ctx.inputMap.get(key)?.secret) {
            ctx.referencedSecrets.add(key)
            return `\${${ctx.varNameFor(key)}}`
        }
        return ctx.values[key] ?? ''
    })
}

function substituteRecord(rec: Record<string, string>, ctx: SubstituteContext): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec)) out[k] = substitute(v, ctx)
    return out
}

function compileMcpServer(tpl: McpServerTemplate, ctx: SubstituteContext, name: string): EngineMcpServer {
    return {
        name,
        transport: tpl.transport,
        command: tpl.command ? substitute(tpl.command, ctx) : undefined,
        args: tpl.args.map(a => substitute(a, ctx)),
        url: tpl.url ? substitute(tpl.url, ctx) : undefined,
        env: substituteRecord(tpl.env, ctx),
        headers: substituteRecord(tpl.headers, ctx),
    }
}

async function upsertSkill(conn: EngineConnection, engineAgentId: string, skill: ServiceSkill): Promise<string | null> {
    try {
        const created = await createSkill(conn, engineAgentId, { name: skill.name, description: skill.description, body: skill.body })
        return created.slug
    } catch {
        const existing = await listSkills(conn, engineAgentId).catch(() => [])
        const match = existing.find(s => s.name === skill.name)
        if (match) {
            await updateSkill(conn, engineAgentId, match.slug, { description: skill.description, body: skill.body })
            return match.slug
        }
        return null
    }
}

export type CompileResult = {
    toolNames: string[]
    oauth: { serverName: string; url: string } | null
    managed: { provider: string; serverName: string } | null
    composio: { toolkit: string; serverName: string } | null
    app: { appSlug: string; serverName: string } | null
}

export type ServiceInstanceTarget = { key: string; instanceId: string }

export async function compileService(
    agentId: string,
    manifest: ServiceManifest,
    values: Record<string, string>,
    authMethodId?: string,
    actor?: Actor,
    instance?: ServiceInstanceTarget,
): Promise<CompileResult> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
    const method = getMethod(manifest, authMethodId)
    const instanceId = instance?.instanceId

    const inputMap = new Map(method.inputs.map(i => [i.key, i]))
    const envKeyByInput = new Map(method.envKeys.map(m => [m.fromInput, m.key]))
    const explicitVar = (key: string) => (instanceId ? instanceEnvVar(key, instanceId) : key)
    const varNameFor = (inputKey: string) => {
        const explicit = envKeyByInput.get(inputKey)
        return explicit ? explicitVar(explicit) : defaultInstanceEnvVar(manifest.slug, instanceId, inputKey)
    }
    const ctx: SubstituteContext = { values, inputMap, varNameFor, referencedSecrets: new Set(), derivedSecrets: {}, engineAgentId }
    const serverNameFor = (templateName: string) => (instanceId ? instanceServerName(templateName, instanceId) : templateName)

    const compiled = method.mcpServers.map(t => {
        const server = compileMcpServer(t, ctx, serverNameFor(t.name))
        if (instanceId && method.kind === 'composio') server.headers = { ...server.headers, 'x-rerun-instance': instanceId }
        return server
    })
    const compiledSkills = manifest.skills.map(s => ({ ...s, body: substitute(s.body, ctx) }))

    const envSet: Record<string, string> = {}
    for (const mapping of method.envKeys) {
        const v = values[mapping.fromInput]
        if (v !== undefined) envSet[explicitVar(mapping.key)] = v
    }
    for (const inputKey of ctx.referencedSecrets) {
        const v = values[inputKey]
        if (v !== undefined && v !== '') envSet[varNameFor(inputKey)] = v
    }
    Object.assign(envSet, ctx.derivedSecrets)
    if (Object.keys(envSet).length > 0) {
        await updateAgentKeys(conn, engineAgentId, { set: envSet })
    }

    if (compiled.length > 0) {
        await patchMcpServers(conn, engineAgentId, { upsert: compiled })
    }

    const skillSlugs: string[] = []
    for (const skill of compiledSkills) {
        const slug = await upsertSkill(conn, engineAgentId, skill)
        if (slug) skillSlugs.push(slug)
    }

    const nonSecretConfig: Record<string, string> = {}
    for (const input of method.inputs) {
        if (!input.secret && values[input.key] !== undefined) nonSecretConfig[input.key] = values[input.key]
    }
    const mcpServerNames = compiled.map(s => s.name)

    const authServer = oauthServer(method)
    const oauth = authServer ? { serverName: serverNameFor(authServer.name), url: substitute(authServer.url ?? '', ctx) } : null
    const renamed = <T extends { serverName: string }>(target: T | null): T | null => (target ? { ...target, serverName: serverNameFor(target.serverName) } : null)
    const managed = renamed(managedTarget(method))
    const composio = renamed(composioTarget(method))
    const app = renamed(appTarget(method))

    const registryKey = instance?.key ?? manifest.slug
    const instanceFields = instance ? await instanceRegistryFields(conn, engineAgentId, manifest, instance) : {}

    await upsertRegistryEntry(conn, engineAgentId, registryKey, {
        status: oauth || managed || composio || app ? 'needs_auth' : 'active',
        config: nonSecretConfig,
        authMethodId: method.id,
        mcpServers: mcpServerNames,
        envKeys: Object.keys(envSet),
        skills: skillSlugs,
        ...(oauth ? { oauth } : {}),
        ...(managed ? { managed } : {}),
        ...(composio ? { composio } : {}),
        ...(app ? { app } : {}),
        ...instanceFields,
        installedAt: new Date().toISOString(),
    })

    return { toolNames: mcpServerNames, oauth, managed, composio, app }
}

async function instanceRegistryFields(conn: EngineConnection, engineAgentId: string, manifest: ServiceManifest, instance: ServiceInstanceTarget): Promise<Pick<RegistryEntry, 'instanceId' | 'label'>> {
    const reg = await readRegistry(conn, engineAgentId)
    const label = reg.services[instance.key]?.label ?? ordinalInstanceLabel(manifest.name, reg, manifest.slug)
    return { instanceId: instance.instanceId, label }
}

export async function decompileService(conn: EngineConnection, engineAgentId: string, entry: RegistryEntry, opts?: { keepSkills?: Set<string> }): Promise<void> {
    const { envKeys, mcpServers, skills } = registryFootprint(entry)

    if (envKeys.length > 0) {
        await updateAgentKeys(conn, engineAgentId, { remove: envKeys })
    }

    if (mcpServers.length > 0) {
        await patchMcpServers(conn, engineAgentId, { remove: mcpServers })
    }

    for (const slug of skills) {
        if (opts?.keepSkills?.has(slug)) continue
        await deleteSkill(conn, engineAgentId, slug).catch(() => {})
    }

    const tokenServer = entry.oauth?.serverName ?? entry.managed?.serverName
    if (tokenServer) {
        await deleteMcpToken(conn, engineAgentId, tokenServer).catch(() => {})
    }

    if (entry.composio?.connectedAccountId) {
        await deleteConnectedAccount(entry.composio.connectedAccountId).catch(err => {
            console.warn(`[composio] could not delete connected account ${entry.composio?.connectedAccountId}:`, err instanceof Error ? err.message : err)
        })
    }
}
