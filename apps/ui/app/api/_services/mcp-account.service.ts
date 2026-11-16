import type { RunGoal } from '@rerun/contracts'
import { MCP_SERVER_NAME_RE, connectorSkillReadOnlyError, FACTORY_SNAPSHOT_MAX_BYTES, factorySnapshotSchema, isSetupAnswered, MAX_TEXT_WRITE_CHARS, providerSchema, runGoalSchema, sleep, triggerMethodSchema, verbositySchema } from '@rerun/contracts'
import { AccessDeniedError, assertAgentInWorkspace, callableEngineAgentIds, isAdminActor, keepVisible, manageableSpaceIds, spaceAccessMap, visibleAgentIds, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import type { Database } from '@/app/api/database.types'
import { putFactorySnapshot } from '@/lib/factory/snapshot-store'
import {
    chat as engineChat,
    createSchedule as engineCreateSchedule,
    createTrigger as engineCreateTrigger,
    deleteSchedule as engineDeleteSchedule,
    deleteSkill as engineDeleteSkill,
    setSkillEnabled as engineSetSkillEnabled,
    deleteTrigger as engineDeleteTrigger,
    SPACE_DATA_BASE,
    agentDataBase,
    agentFilesBase,
    cancelRun as engineCancelRun,
    createMemory as engineCreateMemory,
    executeDb as engineExecuteDb,
    fireTrigger as engineFireTrigger,
    getAgent as engineGetAgent,
    getRun as engineGetRun,
    getRunTools as engineGetRunTools,
    getSkill as engineGetSkill,
    getTrigger as engineGetTrigger,
    importSkill as engineImportSkill,
    listConnections as engineListConnections,
    listDbTables as engineListDbTables,
    listRuns as engineListRuns,
    listSchedules as engineListSchedules,
    listSkills as engineListSkills,
    listTriggers as engineListTriggers,
    patchAgent as enginePatchAgent,
    patchMcpServers as enginePatchMcpServers,
    queryDb as engineQueryDb,
    reconnectMcpServer as engineReconnectMcpServer,
    rotateTriggerToken as engineRotateTriggerToken,
    runScheduleNow as engineRunScheduleNow,
    setBoxDefault as engineSetBoxDefault,
    updateSchedule as engineUpdateSchedule,
    updateTrigger as engineUpdateTrigger,
    uploadFile as engineUploadFile,
    writeFileText as engineWriteFileText,
} from '@/lib/engine/client'
import type { InstalledService } from '@/lib/services/types'
import type { BoxConnection, EngineAgentConfigPatch, EngineMcpServer, EngineAgentDetail, EngineAgentSetup, EngineConnection, EngineRunDetail, EngineTrigger, EngineTriggerMethod } from '@/lib/engine/types'
import { MAX_DUPLICATES_PER_CALL, MAX_MEMORIES_PER_CALL, MAX_MEMORY_CHARS, MAX_UPLOAD_MB } from '@/lib/mcp/account-tools'
import { asBooleanRecord, asNumber, asString, asStringArray, clamp, requireConfirmation, requireString } from '@/lib/mcp/args'
import { connectionModels, readModelPin, type ModelPin } from '@/lib/mcp/model-pin'
import { projectRun } from '@/lib/mcp/run-projection'
import { assertModelEntitled } from '@/app/api/_services/engine-plan.service'
import { truncateField } from '@/lib/mcp/truncate'
import { describeSkillFiles, normalizeSkillFilePath, planSkillFileRemovals, readSkillReferenceFile, removeSkillFiles } from '@/lib/skills/reference-files'
import { connectorMcpServerNames, connectorSkillOwners, readRegistry } from '@/lib/services/registry'
import { slugify } from '@/lib/slugify'
import { MAX_TRIGGER_BODY_BYTES, triggerWebhookUrl } from '@/lib/triggers/webhook'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { changeAgentHandle, createAgent, deleteAgent, duplicateAgent, moveAgentToBox, renameAgent } from './agent.service'
import { declareService, installServiceSlugs } from './agent-setup.service'
import { LOCKED_NOTICE, LOCKED_WRITE_ERROR } from './agent-content.service'
import { ensureSessionRow, resolveAgentTarget } from './chat.service'
import { removeCustomMcpServer } from './custom-mcp.service'
import { followCoworker, recordSessionParticipant } from './notification-audience.service'
import { resolveSpaceTarget } from './space.service'
import { dispatchShareTool } from './mcp-shares.service'
import { allocateServiceInstance, listCatalogServices, listInstalledServices, loadManifest, searchCatalogServices, toAuthMethodSummaries, uninstallService } from './services.service'
import { readTeamStatus } from './team-status.service'
import { getWorkspaceConnection, NoEngineError } from './workspace-engine.service'

type SkillFile = { path: string; content: string }

function asStringRecord(v: unknown, field: string): Record<string, string> {
    if (v === undefined || v === null) return {}
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} must be an object of strings`)
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(v)) {
        if (typeof value !== 'string') throw new Error(`${field}.${key} must be a string`)
        out[key] = value
    }
    return out
}

function readMcpServerArgs(args: Record<string, unknown>): EngineMcpServer {
    const name = requireString(args.name, 'name')
    if (name === 'rerun') throw new Error('"rerun" is reserved for the engine bridge. Pick another name.')
    if (!MCP_SERVER_NAME_RE.test(name)) throw new Error('name must be 1-64 characters: letters, digits, underscores, or hyphens')
    const command = asString(args.command)?.trim() || undefined
    const url = asString(args.url)?.trim() || undefined
    const requested = args.transport
    if (requested !== undefined && requested !== 'stdio' && requested !== 'sse' && requested !== 'http') throw new Error('transport must be stdio, sse or http')
    const transport = requested ?? (url ? 'http' : 'stdio')
    if (transport === 'stdio' && !command) throw new Error('A stdio server needs a command.')
    if (transport !== 'stdio' && !url) throw new Error(`A ${transport} server needs a url.`)
    if (transport !== 'stdio') {
        try {
            new URL(url as string)
        } catch {
            throw new Error('url is not a valid address')
        }
    }
    return {
        name,
        transport,
        ...(transport === 'stdio' ? { command } : { url }),
        args: asStringArray(args.args),
        env: asStringRecord(args.env, 'env'),
        headers: asStringRecord(args.headers, 'headers'),
    }
}

function asSkillFiles(v: unknown): SkillFile[] {
    if (v === undefined) return []
    if (!Array.isArray(v)) throw new Error('files must be an array, e.g. [{"path": "references/api.md", "content": "…"}].')
    return v.map((entry, index) => {
        const { path, content } = (entry ?? {}) as { path?: unknown; content?: unknown }
        if (typeof path !== 'string' || !path || typeof content !== 'string') {
            throw new Error(`files[${index}] needs a non-empty "path" and a "content" string.`)
        }
        return { path, content }
    })
}

type SqlParam = string | number | boolean | null

function asSqlParams(v: unknown): SqlParam[] {
    if (!Array.isArray(v)) return []
    return v.filter((p): p is SqlParam => p === null || typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean')
}

function asSqlStatements(v: unknown): { sql: string; params: SqlParam[] }[] | undefined {
    if (!Array.isArray(v)) return undefined
    const statements = v.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return []
        const { sql, params } = entry as { sql?: unknown; params?: unknown }
        return typeof sql === 'string' && sql ? [{ sql, params: asSqlParams(params) }] : []
    })
    return statements.length > 0 ? statements : undefined
}

function toSkillMarkdown(body: string): string {
    return `---\n---\n\n${body.trim()}\n`
}

function readConfigPatch(args: Record<string, unknown>, pin: ModelPin | undefined): EngineAgentConfigPatch {
    const patch: EngineAgentConfigPatch = { ...pin }
    const verbosity = asString(args.verbosity)
    const tools = asBooleanRecord(args.tools)
    const selfImprovement = asBooleanRecord(args.selfImprovement)

    if (verbosity !== undefined) {
        const parsed = verbositySchema.safeParse(verbosity)
        if (!parsed.success) throw new Error(`Unknown verbosity "${verbosity}". Expected one of: ${verbositySchema.options.join(', ')}`)
        patch.verbosity = parsed.data
    }
    if (tools !== undefined) patch.tools = tools
    if (selfImprovement !== undefined) patch.selfImprovement = selfImprovement
    return patch
}

function namesModelPin(args: Record<string, unknown>): boolean {
    return args.connectionId !== undefined || args.provider !== undefined || args.model !== undefined
}

function unverifiedModelPin(args: Record<string, unknown>): ModelPin {
    const provider = asString(args.provider)
    const parsed = provider === undefined ? null : providerSchema.safeParse(provider)
    if (parsed && !parsed.success) throw new Error(`Unknown provider "${provider}". Expected one of: ${providerSchema.options.join(', ')}`)
    return { connectionId: asString(args.connectionId) ?? null, provider: parsed?.data ?? null, model: asString(args.model) ?? null }
}

async function newAgentModelPin(workspaceId: number, args: Record<string, unknown>): Promise<ModelPin | undefined> {
    if (!namesModelPin(args)) return undefined
    let conn: EngineConnection
    try {
        conn = await getWorkspaceConnection(workspaceId)
    } catch (err) {
        if (err instanceof NoEngineError) return unverifiedModelPin(args)
        throw err
    }
    return readModelPin(args, (await engineListConnections(conn)).connections)
}

type CheckedModelPin = { pin: ModelPin; connections: BoxConnection[] }

async function checkedModelPin(conn: EngineConnection, engineAgentId: string, args: Record<string, unknown>): Promise<CheckedModelPin | undefined> {
    if (!namesModelPin(args)) return undefined
    const { connections } = await engineListConnections(conn)
    const modelAlone = typeof args.model === 'string' && typeof args.connectionId !== 'string' && typeof args.provider !== 'string'
    const current = modelAlone ? (await engineGetAgent(conn, engineAgentId)).resolvedConnectionId : null
    const pin = readModelPin(args, connections, current)
    return pin ? { pin, connections } : undefined
}

function projectRunsOn(detail: EngineAgentDetail, connections: BoxConnection[]) {
    return {
        connectionId: detail.resolvedConnectionId,
        connectionName: connections.find(connection => connection.id === detail.resolvedConnectionId)?.name ?? null,
        provider: detail.resolvedProvider ?? detail.config.provider,
        model: detail.resolvedModel ?? detail.config.model,
        followsWorkspaceDefault: detail.config.model === null,
    }
}

function readSetup(args: Record<string, unknown>): { setup: Partial<EngineAgentSetup>; install: string } | undefined {
    const raw = args.setup
    if (raw === undefined) return undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('setup must be an object, e.g. {"required": true, "prompt": "..."}.')

    const { required, prompt } = raw as { required?: unknown; prompt?: unknown }
    if (typeof required !== 'boolean') throw new Error('setup.required must be true or false. It is the answer to "does this coworker need to be configured after install?".')

    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (!isSetupAnswered({ required, prompt: text })) throw new Error('setup.required is true, so setup.prompt must carry the install instructions the coworker runs on its new owner account.')

    return { setup: { required, completedAt: new Date().toISOString() }, install: required ? text : '' }
}

const RUN_POLL_INTERVAL_MS = 2000
const DEFAULT_WAIT_SECONDS = 120
const MAX_WAIT_SECONDS = 600

function parseTriggerMethod(value: string): EngineTriggerMethod {
    const parsed = triggerMethodSchema.safeParse(value.toUpperCase())
    if (!parsed.success) throw new Error(`Unknown HTTP method "${value}". Expected one of: ${triggerMethodSchema.options.join(', ')}`)
    return parsed.data
}

function asTriggerMethods(v: unknown): EngineTriggerMethod[] | undefined {
    if (v === undefined) return undefined
    if (!Array.isArray(v) || v.length === 0) throw new Error(`methods must be a non-empty array of: ${triggerMethodSchema.options.join(', ')}`)
    return [...new Set(v.map(entry => parseTriggerMethod(String(entry))))]
}

function asTriggerBody(v: unknown): string {
    if (v === undefined || v === null) return ''
    return typeof v === 'string' ? v : JSON.stringify(v)
}

function defaultContentType(body: string): string {
    if (!body) return ''
    const head = body.trimStart()[0]
    return head === '{' || head === '[' ? 'application/json' : 'text/plain'
}

async function projectTrigger(agentId: string, trigger: EngineTrigger) {
    return {
        slug: trigger.slug,
        name: trigger.name,
        description: trigger.description,
        body: trigger.body,
        methods: trigger.methods,
        enabled: trigger.enabled,
        connectionId: trigger.connectionId,
        model: trigger.model,
        lastFiredAt: trigger.lastFiredAt,
        fireCount: trigger.fireCount,
        url: trigger.token ? await triggerWebhookUrl(agentId, trigger.slug, trigger.token) : null,
    }
}

async function waitForRun(conn: EngineConnection, engineAgentId: string, runId: string, waitSeconds: number): Promise<EngineRunDetail> {
    const deadline = Date.now() + waitSeconds * 1000
    let run = await engineGetRun(conn, engineAgentId, runId)
    while (run.status === 'running' && Date.now() < deadline) {
        await sleep(RUN_POLL_INTERVAL_MS)
        run = await engineGetRun(conn, engineAgentId, runId)
    }
    return run
}

async function resolveSpaceId(actor: Actor, requested?: string): Promise<string> {
    const supabase = createServiceRoleClient()
    const [{ data: all }, manageable] = await Promise.all([selectMany(supabase, 'spaces', ['id', 'name'] as const, { workspace_id: actor.workspaceId }), manageableSpaceIds(actor)])
    const spaces = keepVisible(all ?? [], manageable, space => space.id)

    if (spaces.length === 0) throw new Error(all?.length ? 'You manage no Box in this workspace. Create one first, or ask an admin to make you a manager of one.' : 'This account has no Box yet — create one in the Rerun app first.')
    if (requested) {
        if (!spaces.some(space => space.id === requested)) throw new Error('Box not found')
        return requested
    }
    if (spaces.length > 1) throw new Error(`This account has several Boxes, pass spaceId: ${spaces.map(space => `${space.id} (${space.name ?? 'unnamed'})`).join(', ')}`)

    return spaces[0].id
}

async function assertCatalogService(slug: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'services', ['enabled'] as const, { slug })
    if (!data?.enabled) throw new Error(`Unknown app "${slug}". Use search_connectors to find the right slug.`)
}

function connectorView({ key, slug, name, label, status }: InstalledService) {
    return { key, slug, name, label, status }
}

async function listWorkspaceAgents(workspaceId: number, spaceId?: string) {
    const supabase = createServiceRoleClient()
    const { data } = await selectMany(
        supabase,
        'agents',
        ['id', 'name', 'handle', 'description', 'status', 'space_id', 'created_at'] as const,
        spaceId ? { workspace_id: workspaceId, space_id: spaceId } : { workspace_id: workspaceId },
        { column: 'created_at', ascending: false },
    )
    return data ?? []
}

type MemoryEntry = { content: string; kind?: string; tags?: string[] }

function readMemoryEntries(value: unknown): MemoryEntry[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error('memories must be a non-empty array of { content, kind?, tags? }.')
    if (value.length > MAX_MEMORIES_PER_CALL) throw new Error(`At most ${MAX_MEMORIES_PER_CALL} memories per call. Send the rest in another call.`)
    return value.map((entry, index) => {
        const content = typeof entry === 'object' && entry !== null ? (entry as { content?: unknown }).content : undefined
        if (typeof content !== 'string' || !content.trim()) throw new Error(`memories[${index}].content must be a non-empty string.`)
        if (content.length > MAX_MEMORY_CHARS) throw new Error(`memories[${index}] is over ${MAX_MEMORY_CHARS} characters. Split it into several memories.`)
        const { kind, tags } = entry as { kind?: unknown; tags?: unknown }
        return { content, ...(typeof kind === 'string' ? { kind } : {}), ...(Array.isArray(tags) ? { tags: tags.filter((tag): tag is string => typeof tag === 'string') } : {}) }
    })
}

const FACTORY_SNAPSHOT_MAX_SKEW_MS = 120_000

export async function dispatchAccountTool(actor: Actor, name: string, args: Record<string, unknown>, { actorUserId = null }: { actorUserId?: string | null } = {}): Promise<unknown> {
    const workspaceId = actor.workspaceId
    if (typeof args.model === 'string') await assertModelEntitled(args.model, workspaceId)
    switch (name) {
        case 'list_spaces': {
            const supabase = createServiceRoleClient()
            const [{ data: spaces }, agents, visible] = await Promise.all([selectMany(supabase, 'spaces', ['id', 'name', 'created_at'] as const, { workspace_id: workspaceId }), listWorkspaceAgents(workspaceId), spaceAccessMap(actor)])
            return {
                spaces: (spaces ?? []).filter(space => (visible.get(space.id) ?? 'none') !== 'none').map(space => ({
                    id: space.id,
                    name: space.name ?? 'Box',
                    agentCount: agents.filter(agent => agent.space_id === space.id).length,
                    createdAt: space.created_at,
                    access: visible.get(space.id),
                })),
            }
        }

        case 'list_agents': {
            const [agents, visible] = await Promise.all([listWorkspaceAgents(workspaceId, asString(args.spaceId)), visibleSpaceIds(actor)])
            return { agents: keepVisible(agents, visible, agent => agent.space_id) }
        }

        case 'get_team_status': {
            const [status, visible] = await Promise.all([readTeamStatus(workspaceId, { spaceId: asString(args.spaceId), agentId: asString(args.agentId) }), visibleAgentIds(actor)])
            return { ...status, agents: keepVisible(status.agents, visible, agent => agent.id) }
        }

        case 'get_agent': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(agentId, actor)
            const unavailable: string[] = []
            const unreadable = (part: string) => () => {
                unavailable.push(part)
                return []
            }
            const [detail, aiConnections, skills, schedules, triggers, connectors] = await Promise.all([
                engineGetAgent(conn, engineAgentId),
                engineListConnections(conn)
                    .then(list => list.connections)
                    .catch(unreadable('runsOn')),
                engineListSkills(conn, engineAgentId).catch(unreadable('skills')),
                engineListSchedules(conn, engineAgentId).catch(unreadable('schedules')),
                engineListTriggers(conn, engineAgentId).catch(unreadable('triggers')),
                listInstalledServices(agentId, actor)
                    .then(result => result.services)
                    .catch(unreadable('connectors')),
            ])

            return {
                id: agentId,
                handle: detail.config.name,
                name: detail.config.displayName ?? detail.config.name,
                description: detail.config.description,
                soul: contentLocked ? LOCKED_NOTICE : detail.soul,
                provider: detail.resolvedProvider ?? detail.config.provider,
                model: detail.resolvedModel ?? detail.config.model,
                runsOn: projectRunsOn(detail, aiConnections),
                verbosity: detail.config.verbosity,
                tools: detail.config.tools,
                selfImprovement: detail.config.selfImprovement,
                setup: { required: detail.config.setup.required, completedAt: detail.config.setup.completedAt, prompt: detail.install },
                mcpServers: detail.config.mcpServers.map(server => ({ name: server.name, transport: server.transport, url: server.url, ...(server.tools?.length ? { tools: server.tools } : {}) })),
                skills: skills.map(skill => ({ slug: skill.slug, name: skill.name, description: skill.description })),
                schedules: schedules.map(schedule => ({ slug: schedule.slug, name: schedule.name, cron: schedule.cron, runAt: schedule.runAt, enabled: schedule.enabled })),
                triggers: triggers.map(trigger => ({ slug: trigger.slug, name: trigger.name, methods: trigger.methods, enabled: trigger.enabled, lastFiredAt: trigger.lastFiredAt })),
                connectors: connectors.map(connectorView),
                ...(unavailable.length > 0 ? { unavailable } : {}),
            }
        }

        case 'create_agent': {
            const spaceId = await resolveSpaceId(actor, asString(args.spaceId))
            const slugs = Array.isArray(args.connectors) ? args.connectors.filter((slug): slug is string => typeof slug === 'string') : []
            await Promise.all(slugs.map(assertCatalogService))

            const setup = readSetup(args)
            const pin = await newAgentModelPin(workspaceId, args)
            const agent = await createAgent({
                name: requireString(args.name, 'name'),
                description: asString(args.description),
                soulMd: asString(args.soul),
                installMd: setup?.install,
                workspaceId,
                spaceId,
                actor,
                config: { ...readConfigPatch(args, pin), ...(setup ? { setup: setup.setup } : {}) },
            })

            if (slugs.length > 0) await installServiceSlugs(agent.id, slugs, actor)

            const connectors = slugs.length > 0 ? (await listInstalledServices(agent.id, actor)).services : []

            return {
                agentId: agent.id,
                name: agent.name,
                handle: agent.handle,
                spaceId,
                active: !agent.disabled_at,
                ...(agent.disabled_at ? { inactiveReason: 'No free coworker slot on the current plan. Start Pro for unlimited coworkers, or delete a coworker to activate it.' } : {}),
                connectors: connectors.map(connectorView),
            }
        }

        case 'duplicate_agent': {
            const agentId = requireString(args.agentId, 'agentId')
            const count = args.count === undefined ? 1 : asNumber(args.count)
            if (count === undefined || !Number.isInteger(count) || count < 1 || count > MAX_DUPLICATES_PER_CALL) {
                throw new Error(`count must be an integer from 1 to ${MAX_DUPLICATES_PER_CALL}.`)
            }
            const source = await assertAgentInWorkspace(agentId, 'manage', actor)

            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
            const schedules = await engineListSchedules(conn, engineAgentId)
            if (schedules.length > 0) {
                throw new Error(`This coworker has scheduled tasks (${schedules.map(schedule => schedule.name || schedule.slug).join(', ')}), and every copy would run them a second time. Delete them with delete_schedule first, or copy a coworker without any.`)
            }

            const requestedSpaceId = asString(args.spaceId)
            const spaceId = requestedSpaceId ? await resolveSpaceId(actor, requestedSpaceId) : source.space_id

            const copies: { id: string; name: string; handle: string | null; enabled: boolean }[] = []
            for (let i = 0; i < count; i++) {
                try {
                    const { agent } = await duplicateAgent({ actor, agentRowId: agentId, workspaceId, spaceId })
                    copies.push({ id: agent.id, name: agent.name, handle: agent.handle, enabled: !agent.disabled_at })
                } catch (err) {
                    if (copies.length === 0) throw err
                    throw new Error(`Copy ${i + 1} of ${count} failed (${err instanceof Error ? err.message : String(err)}). Already made: ${copies.map(copy => copy.id).join(', ')}.`)
                }
            }

            const switchedOff = copies.filter(copy => !copy.enabled).length
            return {
                copies,
                schedules: 0,
                ...(switchedOff > 0 ? { note: `${switchedOff} of the ${copies.length} copies came back switched off, because the workspace has no free coworker slot; delete or switch off a coworker to free one.` } : {}),
            }
        }

        case 'update_agent': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(agentId, actor, 'manage')
            const soul = typeof args.soul === 'string' ? args.soul : undefined
            if (contentLocked && soul !== undefined) throw new Error(LOCKED_WRITE_ERROR)

            const checked = await checkedModelPin(conn, engineAgentId, args)
            const patch: EngineAgentConfigPatch & { soul?: string; install?: string } = readConfigPatch(args, checked?.pin)
            const description = asString(args.description)
            const setup = readSetup(args)
            if (description !== undefined) patch.description = description
            if (soul !== undefined) patch.soul = soul
            if (setup) {
                patch.setup = setup.setup
                patch.install = setup.install
            }

            const newName = asString(args.name)
            const newHandle = asString(args.handle)
            const renamed = newName ? await renameAgent(agentId, newName) : null
            const rehandled = newHandle ? await changeAgentHandle(agentId, newHandle) : null

            const requestedSpaceId = asString(args.spaceId)
            const moved = requestedSpaceId ? await moveAgentToBox(agentId, await resolveSpaceId(actor, requestedSpaceId), actor) : null
            if (moved && !moved.ok) throw new Error(moved.error)

            let patched: EngineAgentDetail | null = null
            if (Object.keys(patch).length > 0) {
                patched = await enginePatchAgent(conn, engineAgentId, patch)
                if (description !== undefined) {
                    const supabase = createServiceRoleClient()
                    await supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ description }).eq('id', agentId)
                }
            }

            const identity = rehandled ?? renamed
            const handleMoved = Boolean(rehandled) || Boolean(renamed?.handleChanged)
            const identityUpdated = [...(renamed ? ['name'] : []), ...(handleMoved ? ['handle'] : [])]
            return {
                agentId,
                updated: [...identityUpdated, ...Object.keys(patch), ...(moved ? ['spaceId'] : [])],
                ...(moved?.ok ? { spaceId: requestedSpaceId, position: moved.position } : {}),
                ...(identity ? { name: identity.name, handle: identity.handle } : {}),
                ...(patched && checked ? { runsOn: projectRunsOn(patched, checked.connections) } : {}),
            }
        }

        case 'attach_mcp_server': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
            const server = readMcpServerArgs(args)
            if (connectorMcpServerNames(await readRegistry(conn, engineAgentId)).has(server.name)) {
                throw new Error(`"${server.name}" belongs to an app. Manage it from the Apps tab.`)
            }
            await enginePatchMcpServers(conn, engineAgentId, { upsert: [server] })
            return {
                name: server.name,
                transport: server.transport,
                ...(server.command ? { command: server.command } : {}),
                argCount: server.args.length,
                ...(server.url ? { urlOrigin: new URL(server.url).origin } : {}),
                envKeys: Object.keys(server.env).sort(),
                headerKeys: Object.keys(server.headers).sort(),
            }
        }

        case 'detach_mcp_server': {
            const agentId = requireString(args.agentId, 'agentId')
            const name = requireString(args.name, 'name')
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
            const names = ((await engineGetAgent(conn, engineAgentId)).config.mcpServers ?? []).map(server => server.name)
            if (!names.includes(name)) throw new Error(`Coworker has no tool server named "${name}".`)
            await removeCustomMcpServer(agentId, name, actor)
            return { removed: name, remaining: names.filter(other => other !== name) }
        }

        case 'set_mcp_server_tools': {
            const agentId = requireString(args.agentId, 'agentId')
            const name = requireString(args.name, 'name')
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
            const tools = args.tools
            if (!Array.isArray(tools) || tools.length > 200 || tools.some(tool => typeof tool !== 'string' || tool.length === 0 || tool.length > 128)) {
                throw new Error('tools must be a list of at most 200 names of 1 to 128 characters.')
            }
            const server = ((await engineGetAgent(conn, engineAgentId)).config.mcpServers ?? []).find(entry => entry.name === name)
            if (!server) throw new Error(`Coworker has no tool server named "${name}".`)
            if (connectorMcpServerNames(await readRegistry(conn, engineAgentId)).has(name)) {
                throw new Error(`"${name}" belongs to an app. Manage it from the Apps tab.`)
            }
            const { tools: _previous, ...rest } = server
            await enginePatchMcpServers(conn, engineAgentId, { upsert: [tools.length > 0 ? { ...rest, tools: tools as string[] } : rest] })
            return { name, picks: tools as string[] }
        }

        case 'list_ai_connections': {
            const { connections, default: workspaceDefault } = await engineListConnections(await getWorkspaceConnection(workspaceId))
            return {
                default: workspaceDefault ? { ...workspaceDefault, connectionName: connections.find(connection => connection.id === workspaceDefault.connectionId)?.name ?? null } : null,
                connections: connections.map(connection => ({
                    id: connection.id,
                    name: connection.name,
                    provider: connection.provider,
                    models: connectionModels(connection),
                    connected: connection.connected,
                    isDefault: workspaceDefault?.connectionId === connection.id,
                    planLimits: connection.planLimits ? { windows: connection.planLimits.windows, readAt: connection.planLimits.capturedAt } : null,
                    signIn: connection.signIn ? { minutesLeft: connection.signIn.minutesLeft, renewalDue: connection.signIn.renewalDue } : null,
                })),
            }
        }

        case 'set_default_model': {
            if (!isAdminActor(actor)) throw new AccessDeniedError('adminOnlyDefaultModel')
            const conn = await getWorkspaceConnection(workspaceId)
            const { connections } = await engineListConnections(conn)
            const pin = readModelPin({ connectionId: requireString(args.connectionId, 'connectionId'), model: requireString(args.model, 'model') }, connections)
            if (!pin?.connectionId || !pin.model) throw new Error('set_default_model needs a connectionId and a model.')
            await assertModelEntitled(pin.model, workspaceId)
            await engineSetBoxDefault(conn, { connectionId: pin.connectionId, model: pin.model })
            return { default: { connectionId: pin.connectionId, connectionName: connections.find(connection => connection.id === pin.connectionId)?.name ?? null, provider: pin.provider, model: pin.model } }
        }

        case 'delete_agent': {
            const agentId = requireString(args.agentId, 'agentId')
            requireConfirmation(args, 'the coworker, its skills, its scheduled tasks, its memory and its files')
            await assertAgentInWorkspace(agentId, 'manage', actor)
            await deleteAgent(agentId)
            return { agentId, deleted: true }
        }

        case 'list_skills': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            const skills = await engineListSkills(conn, engineAgentId)
            const owners = connectorSkillOwners(await readRegistry(conn, engineAgentId))
            return {
                skills: skills.map(skill => {
                    const connector = owners.get(skill.slug)
                    return {
                        slug: skill.slug,
                        name: skill.name,
                        description: skill.description,
                        files: skill.files,
                        enabled: skill.enabled !== false,
                        ...(connector ? { connector, readOnly: true } : {}),
                    }
                }),
            }
        }

        case 'get_skill': {
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            const skill = await engineGetSkill(conn, engineAgentId, requireString(args.slug, 'slug'))
            const files = await describeSkillFiles(conn, engineAgentId, skill.slug, skill.files)
            const connector = connectorSkillOwners(await readRegistry(conn, engineAgentId)).get(skill.slug)
            const origin = connector ? { connector, readOnly: true } : {}
            return contentLocked ? { ...skill, body: LOCKED_NOTICE, locked: true, files, ...origin } : { ...skill, files, ...origin }
        }

        case 'read_skill_file': {
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            if (contentLocked) throw new Error(LOCKED_NOTICE)
            const slug = requireString(args.slug, 'slug')
            const offset = asNumber(args.offset)
            if (args.offset !== undefined && (offset === undefined || !Number.isInteger(offset) || offset < 0)) {
                throw new Error('offset must be a non-negative integer.')
            }
            return { slug, ...(await readSkillReferenceFile(conn, engineAgentId, slug, requireString(args.path, 'path'), offset ?? 0)) }
        }

        case 'upsert_skill': {
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            if (contentLocked) throw new Error(LOCKED_WRITE_ERROR)
            const files = asSkillFiles(args.files)
            const removeFiles = planSkillFileRemovals(asStringArray(args.removeFiles))
            const written = new Set(files.map(file => normalizeSkillFilePath(file.path)))
            const contradiction = removeFiles.find(path => written.has(path))
            if (contradiction) throw new Error(`"${contradiction}" is in both files and removeFiles. Pick one.`)

            const target = asString(args.slug) ?? slugify(requireString(args.name, 'name'))
            const owner = connectorSkillOwners(await readRegistry(conn, engineAgentId)).get(target)
            if (owner) throw new Error(connectorSkillReadOnlyError(target, owner))

            const skill = await engineImportSkill(conn, engineAgentId, toSkillMarkdown(requireString(args.body, 'body')), files, {
                name: requireString(args.name, 'name'),
                description: asString(args.description) ?? '',
                slug: asString(args.slug),
                overwrite: true,
            })

            if (removeFiles.length === 0) return { slug: skill.slug, name: skill.name, description: skill.description, files: skill.files }
            await removeSkillFiles(conn, engineAgentId, skill.slug, removeFiles)
            const updated = await engineGetSkill(conn, engineAgentId, skill.slug)
            return { slug: updated.slug, name: updated.name, description: updated.description, files: updated.files, removed: removeFiles }
        }

        case 'write_memory': {
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            if (contentLocked) throw new Error(LOCKED_WRITE_ERROR)
            const memories = readMemoryEntries(args.memories)
            const written: string[] = []
            const failed: { index: number; error: string }[] = []
            for (const [index, memory] of memories.entries()) {
                try {
                    const { id } = await engineCreateMemory(conn, engineAgentId, memory)
                    if (id) written.push(id)
                } catch (err) {
                    failed.push({ index, error: err instanceof Error ? err.message : 'Write failed' })
                }
            }
            return { written: written.length, ids: written, ...(failed.length > 0 ? { failed } : {}) }
        }

        case 'upload_workspace_file': {
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            if (contentLocked) throw new Error(LOCKED_WRITE_ERROR)
            const path = requireString(args.path, 'path').replace(/^\/+/, '')
            const content = typeof args.content === 'string' ? args.content : ''
            const base = agentFilesBase(engineAgentId)
            const isBase64 = args.encoding === 'base64'
            const bytes = Buffer.from(content, isBase64 ? 'base64' : 'utf8')
            if (bytes.byteLength > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`The file is over ${MAX_UPLOAD_MB} MB${isBase64 ? ' once decoded' : ''}.`)
            const slash = path.lastIndexOf('/')
            const name = path.slice(slash + 1)
            if (!name) throw new Error('path must name a file, e.g. "assets/logo.png".')
            if (!isBase64 && content.length <= MAX_TEXT_WRITE_CHARS) {
                await engineWriteFileText(conn, base, path, content)
            } else {
                await engineUploadFile(conn, base, new File([bytes], name), slash > 0 ? path.slice(0, slash) : '')
            }
            return { path, bytes: bytes.byteLength }
        }

        case 'set_skill_enabled': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            const slug = requireString(args.slug, 'slug')
            if (typeof args.enabled !== 'boolean') throw new Error('enabled must be true or false.')
            return engineSetSkillEnabled(conn, engineAgentId, slug, args.enabled)
        }

        case 'delete_skill': {
            requireConfirmation(args, 'the skill and its reference files')
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            const slug = requireString(args.slug, 'slug')
            const owner = connectorSkillOwners(await readRegistry(conn, engineAgentId)).get(slug)
            if (owner) throw new Error(connectorSkillReadOnlyError(slug, owner))
            await engineDeleteSkill(conn, engineAgentId, slug)
            return { slug, deleted: true }
        }

        case 'list_schedules': {
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            const schedules = await engineListSchedules(conn, engineAgentId)
            return { schedules: schedules.map(schedule => (contentLocked ? { ...schedule, body: LOCKED_NOTICE } : schedule)) }
        }

        case 'upsert_schedule': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(agentId, actor, 'manage')
            if (contentLocked && args.body !== undefined) throw new Error(LOCKED_WRITE_ERROR)
            const slug = asString(args.slug)
            const checked = await checkedModelPin(conn, engineAgentId, args)

            const shared = {
                ...checked?.pin,
                description: asString(args.description),
                body: typeof args.body === 'string' ? args.body : undefined,
                cron: asString(args.cron),
                runAt: asString(args.runAt),
                timezone: asString(args.timezone),
                enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
            }

            if (slug) {
                return await engineUpdateSchedule(conn, engineAgentId, slug, shared)
            }

            const cron = shared.cron
            const runAt = shared.runAt
            if (!cron && !runAt) throw new Error('A new scheduled task needs either cron (recurring) or runAt (one-off)')

            const schedule = await engineCreateSchedule(conn, engineAgentId, {
                ...checked?.pin,
                name: requireString(args.name, 'name'),
                description: shared.description,
                body: requireString(args.body, 'body'),
                cron,
                runAt,
                timezone: shared.timezone,
                enabled: shared.enabled,
            })
            await followCoworker(actorUserId, agentId)
            return schedule
        }

        case 'run_schedule_now': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            return await engineRunScheduleNow(conn, engineAgentId, requireString(args.slug, 'slug'))
        }

        case 'delete_schedule': {
            requireConfirmation(args, 'the scheduled task')
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            const slug = requireString(args.slug, 'slug')
            await engineDeleteSchedule(conn, engineAgentId, slug)
            return { slug, deleted: true }
        }

        case 'list_triggers': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(agentId, actor)
            const triggers = await engineListTriggers(conn, engineAgentId)
            return { triggers: await Promise.all(triggers.map(trigger => projectTrigger(agentId, contentLocked ? { ...trigger, body: LOCKED_NOTICE } : trigger))) }
        }

        case 'upsert_trigger': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(agentId, actor, 'manage')
            if (contentLocked && args.body !== undefined) throw new Error(LOCKED_WRITE_ERROR)
            const slug = asString(args.slug)
            const checked = await checkedModelPin(conn, engineAgentId, args)

            const shared = {
                ...checked?.pin,
                description: asString(args.description),
                body: typeof args.body === 'string' ? args.body : undefined,
                methods: asTriggerMethods(args.methods),
                enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
            }

            if (slug) {
                return await projectTrigger(agentId, await engineUpdateTrigger(conn, engineAgentId, slug, shared))
            }

            const trigger = await engineCreateTrigger(conn, engineAgentId, {
                ...checked?.pin,
                name: requireString(args.name, 'name'),
                description: shared.description,
                body: requireString(args.body, 'body'),
                methods: shared.methods,
                enabled: shared.enabled,
            })
            await followCoworker(actorUserId, agentId)

            return await projectTrigger(agentId, trigger)
        }

        case 'test_trigger': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor)
            const slug = requireString(args.slug, 'slug')
            const trigger = await engineGetTrigger(conn, engineAgentId, slug)

            const requested = asString(args.method)
            const method = requested ? parseTriggerMethod(requested) : (trigger.methods[0] ?? 'POST')

            if (!trigger.methods.includes(method)) throw new Error(`This trigger does not accept ${method}. It accepts: ${trigger.methods.join(', ')}.`)
            if (!trigger.enabled) throw new Error(`Trigger "${slug}" is disabled, and a disabled trigger turns every call away. Enable it with upsert_trigger before testing.`)

            const body = asTriggerBody(args.body)
            const bodyBytes = Buffer.byteLength(body, 'utf8')
            if (bodyBytes > MAX_TRIGGER_BODY_BYTES) throw new Error(`The payload is ${bodyBytes} bytes, over the ${MAX_TRIGGER_BODY_BYTES} the public webhook accepts.`)

            const outcome = await engineFireTrigger(conn, engineAgentId, slug, {
                token: trigger.token,
                method,
                query: asString(args.query) ?? '',
                contentType: asString(args.contentType) ?? defaultContentType(body),
                body,
                bodyBytes,
            })

            if (outcome.status === 405) throw new Error(`This trigger does not accept ${method}. It accepts: ${(outcome.allow ?? trigger.methods).join(', ')}.`)
            if (outcome.status !== 202 || !outcome.runId) throw new Error(`The engine turned the call away (${outcome.status}). A trigger disabled or deleted in the meantime answers exactly like a missing one.`)

            return { slug, method, runId: outcome.runId, sessionId: outcome.sessionId, note: 'The run started. Read the outcome with get_run.' }
        }

        case 'rotate_trigger_token': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
            const trigger = await engineRotateTriggerToken(conn, engineAgentId, requireString(args.slug, 'slug'))
            return { ...(await projectTrigger(agentId, trigger)), note: 'The previous URL no longer fires. Update every service configured with it.' }
        }

        case 'delete_trigger': {
            requireConfirmation(args, 'the webhook trigger and its URL')
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            const slug = requireString(args.slug, 'slug')
            await engineDeleteTrigger(conn, engineAgentId, slug)
            return { slug, deleted: true }
        }

        case 'send_message': {
            const agentId = requireString(args.agentId, 'agentId')
            const [{ conn, engineAgentId }, callableAgentIds] = await Promise.all([resolveAgentTarget(agentId, actor), callableEngineAgentIds(actor)])
            const waitSeconds = clamp(asNumber(args.waitSeconds), DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS)

            let goal: RunGoal | undefined
            if (args.goal !== undefined) {
                const parsed = runGoalSchema.safeParse(args.goal)
                if (!parsed.success) throw new Error(`invalid_goal: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'goal'} ${issue.message}`).join('; ')}`)
                goal = parsed.data
            }

            let model: string | undefined
            if (args.model !== undefined) {
                if (typeof args.model !== 'string' || args.model.length < 1 || args.model.length > 100 || !/^[a-z0-9][a-z0-9.-]*$/.test(args.model)) {
                    throw new Error('invalid_run_model: model must be 1 to 100 characters of lowercase letters, digits, dots and hyphens, starting with a letter or digit')
                }
                model = args.model
            }
            let thinkingLevel: string | undefined
            if (args.thinkingLevel !== undefined) {
                if (args.thinkingLevel !== 'low' && args.thinkingLevel !== 'medium' && args.thinkingLevel !== 'high') throw new Error('invalid_run_model: thinkingLevel must be low, medium or high')
                thinkingLevel = args.thinkingLevel
            }

            const res = await engineChat(conn, engineAgentId, { message: requireString(args.message, 'message'), sessionId: asString(args.sessionId), source: 'api', callableAgentIds, ...(goal ? { goal } : {}), ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) })
            if (!res.ok) {
                const body = await res.text().catch(() => '')
                if (res.status === 400 && body.includes('invalid_goal')) throw new Error(`invalid_goal: the engine refused the goal. ${body}`.trim())
                throw new Error(`The coworker could not be reached: ${res.status} ${body}`.trim())
            }

            const runId = res.headers.get('x-run-id')
            const sessionId = res.headers.get('x-session-id')
            await res.body?.cancel().catch(() => {})
            if (!runId) throw new Error('The engine accepted the message but did not return a run id.')
            if (sessionId) await recordSessionParticipant(await ensureSessionRow(agentId, sessionId, requireString(args.message, 'message'), { source: 'api', status: 'working' }), actorUserId)

            const run = await waitForRun(conn, engineAgentId, runId, waitSeconds)
            return {
                ...projectRun(run),
                sessionId: sessionId ?? run.sessionId,
                output: run.output ?? null,
                ...(run.status === 'running' ? { note: `Still working after ${waitSeconds}s. The run continues — read it later with get_run.` } : {}),
            }
        }

        case 'list_runs': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            const runs = await engineListRuns(conn, engineAgentId, { limit: clamp(asNumber(args.limit), 20, 200) })
            return { runs: runs.map(projectRun) }
        }

        case 'cancel_run': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'use')
            const runId = requireString(args.runId, 'runId')
            const before = await engineGetRun(conn, engineAgentId, runId)
            await engineCancelRun(conn, engineAgentId, runId)
            const after = await engineGetRun(conn, engineAgentId, runId)
            return { ...projectRun(after), wasRunning: before.status === 'running' }
        }

        case 'reconnect_mcp_server': {
            const agentId = requireString(args.agentId, 'agentId')
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'use')
            const result = await engineReconnectMcpServer(conn, engineAgentId, requireString(args.name, 'name'))
            return { agentId, name: result.name, reconnected: result.reconnected, effect: result.effect, announced: result.announced }
        }

        case 'get_run': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            const runId = requireString(args.runId, 'runId')
            const run = await engineGetRun(conn, engineAgentId, runId)
            const toolCalls = args.includeToolCalls === true ? await engineGetRunTools(conn, engineAgentId, runId) : null

            return {
                ...projectRun(run),
                output: run.output ?? null,
                ...(toolCalls
                    ? {
                          toolCalls: toolCalls.map(call => ({
                              step: call.stepNumber,
                              tool: call.toolName,
                              input: truncateField(call.inputJson),
                              result: truncateField(call.resultJson),
                              isError: call.isError === 1,
                              durationMs: call.durationMs,
                          })),
                      }
                    : {}),
            }
        }

        case 'list_tables': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            return { tables: await engineListDbTables(conn, agentDataBase(engineAgentId)) }
        }

        case 'db_query': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor)
            return await engineQueryDb(conn, agentDataBase(engineAgentId), {
                sql: requireString(args.sql, 'sql'),
                params: asSqlParams(args.params),
                limit: clamp(asNumber(args.limit), 100, 1000),
            })
        }

        case 'db_execute': {
            const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), actor, 'manage')
            const statements = asSqlStatements(args.statements)
            const sql = asString(args.sql)
            if (!statements && !sql) throw new Error('Provide either sql (one statement) or statements (several, applied atomically).')
            return await engineExecuteDb(conn, agentDataBase(engineAgentId), { sql, params: asSqlParams(args.params), statements })
        }

        case 'list_space_tables': {
            const { conn } = await resolveSpaceTarget(requireString(args.spaceId, 'spaceId'), workspaceId)
            return { tables: await engineListDbTables(conn, SPACE_DATA_BASE) }
        }

        case 'space_db_query': {
            const { conn } = await resolveSpaceTarget(requireString(args.spaceId, 'spaceId'), workspaceId)
            return await engineQueryDb(conn, SPACE_DATA_BASE, {
                sql: requireString(args.sql, 'sql'),
                params: asSqlParams(args.params),
                limit: clamp(asNumber(args.limit), 100, 1000),
            })
        }

        case 'space_db_execute': {
            const { conn } = await resolveSpaceTarget(requireString(args.spaceId, 'spaceId'), workspaceId)
            const statements = asSqlStatements(args.statements)
            const sql = asString(args.sql)
            if (!statements && !sql) throw new Error('Provide either sql (one statement) or statements (several, applied atomically).')
            return await engineExecuteDb(conn, SPACE_DATA_BASE, { sql, params: asSqlParams(args.params), statements })
        }

        case 'search_connectors': {
            const results = await searchCatalogServices(asString(args.query), asString(args.category))
            return { connectors: results.map(({ slug, name, category, summary, setup, setupReason }) => ({ slug, name, category, summary, setup, setupReason })) }
        }

        case 'list_connectors': {
            const limit = clamp(asNumber(args.limit), 60, 200)
            const offset = Math.max(Math.trunc(asNumber(args.offset) ?? 0), 0)
            const category = asString(args.category)

            const supabase = createServiceRoleClient()
            const [results, { data: total }] = await Promise.all([
                listCatalogServices({ category, limit, offset }),
                selectCount(supabase, 'services', category ? { enabled: true, category } : { enabled: true }),
            ])

            return {
                total: total ?? 0,
                offset,
                connectors: results.map(({ slug, name, category: serviceCategory, summary, setup }) => ({ slug, name, category: serviceCategory, summary, setup })),
            }
        }

        case 'list_agent_connectors': {
            const agentId = requireString(args.agentId, 'agentId')
            const { services } = await listInstalledServices(agentId, actor)
            return { connectors: services.map(service => ({ ...connectorView(service), toolNames: service.toolNames })) }
        }

        case 'attach_connector': {
            const agentId = requireString(args.agentId, 'agentId')
            const slug = requireString(args.slug, 'slug')
            const [, manifest] = await Promise.all([resolveAgentTarget(agentId, actor, 'manage'), loadManifest(slug)])
            if (!manifest || manifest.slug !== slug) throw new Error(`Unknown app "${slug}". Use search_connectors to find the right slug.`)

            const instance = args.newInstance === true && manifest.multiInstance ? await allocateServiceInstance(agentId, manifest, actor) : undefined
            const key = instance?.key ?? manifest.slug
            const declared = await declareService(agentId, manifest, actor, instance)

            const { services } = await listInstalledServices(agentId, actor)
            const installed = services.find(service => service.key === key)
            const status = installed?.status ?? 'needs_config'
            const name = installed?.name ?? manifest.name
            const label = installed?.label ?? instance?.label

            return {
                key,
                slug,
                name,
                ...(label ? { label } : {}),
                status,
                ...(declared === 'needs_config' ? { authMethods: toAuthMethodSummaries(manifest).map(method => ({ id: method.id, label: method.label, kind: method.kind, requiresSecrets: method.requiresSecrets })) } : {}),
                message:
                    status === 'active'
                        ? `${name} is installed and its tools are available to the coworker.`
                        : `${name} is declared on the coworker and waiting for the account owner to connect it from the Rerun app (coworker panel, Services tab). Do not ask anyone for credentials here.`,
            }
        }

        case 'detach_connector': {
            requireConfirmation(args, 'the app, its tools and its credentials')
            const agentId = requireString(args.agentId, 'agentId')
            const key = asString(args.key) ?? asString(args.slug)
            if (!key) throw new Error('Pass key (from list_agent_connectors) or slug.')
            await uninstallService(agentId, key, actor)
            return { key, detached: true }
        }

        case 'factory_report': {
            if (!isAdminActor(actor)) throw new AccessDeniedError('adminOnly')
            const text = JSON.stringify(args.snapshot ?? null)
            const size = Buffer.byteLength(text, 'utf8')
            if (size > FACTORY_SNAPSHOT_MAX_BYTES) throw new Error(`factory_report: the snapshot is over ${FACTORY_SNAPSHOT_MAX_BYTES} bytes`)
            const parsed = factorySnapshotSchema.safeParse(args.snapshot)
            if (!parsed.success) throw new Error('factory_report: the snapshot does not match the schema')
            if (Date.parse(parsed.data.madeAt) > Date.now() + FACTORY_SNAPSHOT_MAX_SKEW_MS) throw new Error('factory_report: the snapshot is dated in the future')
            return { kept: putFactorySnapshot(workspaceId, parsed.data) }
        }

        default:
            return await dispatchShareTool(actor, name, args)
    }
}
