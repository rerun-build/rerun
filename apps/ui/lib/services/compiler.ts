import type { Actor } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { createSkill, deleteMcpToken, deleteSkill, listSkills, patchMcpServers, updateAgentKeys, updateSkill } from '@/lib/engine/client'
import type { EngineConnection, EngineMcpServer } from '@/lib/engine/types'
import type { InputDef, McpServerTemplate, ServiceManifest, ServiceSkill } from './manifest'
import { deleteConnectedAccount } from '@/lib/composio/client'
import { defaultInstanceEnvVar, instanceEnvVar, instanceServerName, ordinalInstanceLabel } from './instances'
import { appTarget, composioTarget, getMethod, managedTarget, oauthServer } from './manifest'
import { type RegistryEntry, readRegistry, registryFootprint, upsertRegistryEntry } from './registry'

// Substitution context shared by every template string in a compile pass. Non-secret
// inputs are inlined; secret inputs are NOT — their value goes to the engine .env and
// the compiled config keeps only a ${VAR} reference, resolved engine-side at connect time.
type SubstituteContext = {
    values: Record<string, string>
    inputMap: Map<string, InputDef>
    varNameFor: (inputKey: string) => string
    referencedSecrets: Set<string>
    derivedSecrets: Record<string, string>
    engineAgentId: string
}

// `${basic:input.A:input.B}` becomes HTTP Basic credentials, base64("A:B"). The engine only
// resolves plain ${VAR} references, so the encoding happens here and lands in its own secret.
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

// ${agent.id} is resolved here (the engine's ${VAR} resolver can't — it disallows the dot),
// so a managed proxy server can carry the agent id in a header. ${RERUN_API_KEY} /
// ${RERUN_HUB_BASE_URL} are left intact for the engine to resolve from its own env.
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

// Turn an mcpServer template into a concrete engine server config. Secret values are kept
// out of config.json (only ${VAR} refs remain) — never in Supabase, never in cleartext.
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

// Create the skill, or update it in place if a skill with the same name already exists
// (re-install must be idempotent). Returns the engine slug so uninstall can delete it.
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

// An extra account of an app: its registry key (`gmail@k3x9ab`) and the id that suffixes its
// server names and env vars, so it never overwrites the base account's.
export type ServiceInstanceTarget = { key: string; instanceId: string }

// Everything an install of one service puts on a coworker, before it is written anywhere: the
// coworker's own folder, or a Vault item that any number of coworkers draw on.
export type CompiledService = CompileResult & {
    servers: EngineMcpServer[]
    env: Record<string, string>
    skills: ServiceSkill[]
    // The non-secret inputs, kept so a reconfigure opens filled in.
    config: Record<string, string>
    authMethodId: string
    status: 'active' | 'needs_auth'
}

// `agentRef` is what `${agent.id}` becomes: the coworker's own engine id for an install in its
// folder, `${RERUN_AGENT_ID}` for a Vault item, which the engine resolves to whichever coworker calls.
export function compileServiceParts(manifest: ServiceManifest, values: Record<string, string>, authMethodId: string | undefined, agentRef: string, instanceId?: string): CompiledService {
    const method = getMethod(manifest, authMethodId)
    const inputMap = new Map(method.inputs.map(i => [i.key, i]))
    const envKeyByInput = new Map(method.envKeys.map(m => [m.fromInput, m.key]))
    const explicitVar = (key: string) => (instanceId ? instanceEnvVar(key, instanceId) : key)
    const varNameFor = (inputKey: string) => {
        const explicit = envKeyByInput.get(inputKey)
        return explicit ? explicitVar(explicit) : defaultInstanceEnvVar(manifest.slug, instanceId, inputKey)
    }
    const ctx: SubstituteContext = { values, inputMap, varNameFor, referencedSecrets: new Set(), derivedSecrets: {}, engineAgentId: agentRef }
    const serverNameFor = (templateName: string) => (instanceId ? instanceServerName(templateName, instanceId) : templateName)

    // Compile first so `referencedSecrets` is populated before we assemble the .env set.
    const servers = method.mcpServers.map(t => {
        const server = compileMcpServer(t, ctx, serverNameFor(t.name))
        // The Composio proxy derives the instance's own Composio user from this header.
        if (instanceId && method.kind === 'composio') server.headers = { ...server.headers, 'x-rerun-instance': instanceId }
        return server
    })
    const skills = manifest.skills.map(skill => ({ ...skill, body: substitute(skill.body, ctx) }))

    // Secrets: the union of the method's explicit envKeys, any secret input referenced by an mcp
    // template, and the Basic credentials derived from them.
    const env: Record<string, string> = {}
    for (const mapping of method.envKeys) {
        const v = values[mapping.fromInput]
        if (v !== undefined) env[explicitVar(mapping.key)] = v
    }
    for (const inputKey of ctx.referencedSecrets) {
        const v = values[inputKey]
        if (v !== undefined && v !== '') env[varNameFor(inputKey)] = v
    }
    Object.assign(env, ctx.derivedSecrets)

    const config: Record<string, string> = {}
    for (const input of method.inputs) {
        if (!input.secret && values[input.key] !== undefined) config[input.key] = values[input.key]
    }

    // An OAuth / managed service is only usable once the user signs in — the sign-in writes
    // the token to the engine token store and the connect action flips this to 'active'.
    const authServer = oauthServer(method)
    const oauth = authServer ? { serverName: serverNameFor(authServer.name), url: substitute(authServer.url ?? '', ctx) } : null
    const renamed = <T extends { serverName: string }>(target: T | null): T | null => (target ? { ...target, serverName: serverNameFor(target.serverName) } : null)
    const managed = renamed(managedTarget(method))
    const composio = renamed(composioTarget(method))
    const app = renamed(appTarget(method))

    return {
        toolNames: servers.map(server => server.name),
        oauth,
        managed,
        composio,
        app,
        servers,
        env,
        skills,
        config,
        authMethodId: method.id,
        status: oauth || managed || composio || app ? 'needs_auth' : 'active',
    }
}

// Compile a service into engine primitives, using the selected auth method (falls back to
// the default). Assumes all REQUIRED inputs of that method are present in `values` (the
// caller — installService — guards this). Idempotent: safe to re-run.
export async function compileService(
    agentId: string,
    manifest: ServiceManifest,
    values: Record<string, string>,
    authMethodId?: string,
    actor?: Actor,
    instance?: ServiceInstanceTarget,
): Promise<CompileResult> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
    const compiled = compileServiceParts(manifest, values, authMethodId, engineAgentId, instance?.instanceId)

    // 1. Secrets → engine .env (never Supabase, never cleartext in config.json).
    if (Object.keys(compiled.env).length > 0) {
        await updateAgentKeys(conn, engineAgentId, { set: compiled.env })
    }

    // 2. MCP servers → engine merges by name atomically (never send the whole array).
    if (compiled.servers.length > 0) {
        await patchMcpServers(conn, engineAgentId, { upsert: compiled.servers })
    }

    // 3. Behavioural instructions → skills (shared across methods; collect slugs for clean uninstall).
    const skillSlugs: string[] = []
    for (const skill of compiled.skills) {
        const slug = await upsertSkill(conn, engineAgentId, skill)
        if (slug) skillSlugs.push(slug)
    }

    // 4. Record installed-state in the agent's OWN registry on the engine (LAST — if it
    //    fails the agent still has working tools). Only non-secret config is stored,
    //    plus the footprint (mcpServers/envKeys/skills) so uninstall can reverse it.
    const registryKey = instance?.key ?? manifest.slug
    // A recompile of an existing account keeps the label it already has (an email, or its ordinal).
    const instanceFields = instance ? await instanceRegistryFields(conn, engineAgentId, manifest, instance) : {}
    const { oauth, managed, composio, app } = compiled

    await upsertRegistryEntry(conn, engineAgentId, registryKey, {
        status: compiled.status,
        config: compiled.config,
        authMethodId: compiled.authMethodId,
        mcpServers: compiled.toolNames,
        envKeys: Object.keys(compiled.env),
        skills: skillSlugs,
        ...(oauth ? { oauth } : {}),
        ...(managed ? { managed } : {}),
        ...(composio ? { composio } : {}),
        ...(app ? { app } : {}),
        ...instanceFields,
        installedAt: new Date().toISOString(),
    })

    return { toolNames: compiled.toolNames, oauth, managed, composio, app }
}

async function instanceRegistryFields(conn: EngineConnection, engineAgentId: string, manifest: ServiceManifest, instance: ServiceInstanceTarget): Promise<Pick<RegistryEntry, 'instanceId' | 'label'>> {
    const reg = await readRegistry(conn, engineAgentId)
    const label = reg.services[instance.key]?.label ?? ordinalInstanceLabel(manifest.name, reg, manifest.slug)
    return { instanceId: instance.instanceId, label }
}

// Reverse of compileService: strip exactly what the install added (recorded in the
// registry entry), preserving the Hub and every other installed service.
// `keepSkills` lists the skills another account of the same app still relies on.
export async function decompileService(conn: EngineConnection, engineAgentId: string, entry: RegistryEntry, opts?: { keepSkills?: Set<string> }): Promise<void> {
    // A Vault item put nothing in the coworker's folder: detaching it is the whole uninstall.
    if (entry.vaultItemId) return
    const { envKeys, mcpServers, skills } = registryFootprint(entry)

    // 1. Remove the engine .env keys this service set.
    if (envKeys.length > 0) {
        await updateAgentKeys(conn, engineAgentId, { remove: envKeys })
    }

    // 2. Remove the service's MCP servers (engine removes by name — keeps rerun_hub + others).
    if (mcpServers.length > 0) {
        await patchMcpServers(conn, engineAgentId, { remove: mcpServers })
    }

    // 3. Delete the skills this service created (ignore if already gone).
    for (const slug of skills) {
        if (opts?.keepSkills?.has(slug)) continue
        await deleteSkill(conn, engineAgentId, slug).catch(() => {})
    }

    // 4. Clear the OAuth token from the engine token store, for an OAuth or managed service.
    const tokenServer = entry.oauth?.serverName ?? entry.managed?.serverName
    if (tokenServer) {
        await deleteMcpToken(conn, engineAgentId, tokenServer).catch(() => {})
    }

    // 5. A Composio service has no engine token: revoking means deleting the connected
    //    account at Composio. Best-effort — the engine teardown above must not be undone by
    //    a Composio outage; a residual account is removable from the Composio dashboard.
    if (entry.composio?.connectedAccountId) {
        await deleteConnectedAccount(entry.composio.connectedAccountId).catch(err => {
            console.warn(`[composio] could not delete connected account ${entry.composio?.connectedAccountId}:`, err instanceof Error ? err.message : err)
        })
    }
}
