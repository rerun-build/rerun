import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extract } from 'tar'
import { agentImportResultSchema, type AgentArchiveMcpAuth, type AgentImportResult, type McpServer } from '@rerun/contracts'
import { agentDir, agentsDir, dataDir, skillsDir, soulPath, workspaceDir } from '../config/paths.js'
import { newId, nowIso } from '../lib/ids.js'
import { badRequest } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { capAt } from '../lib/stream.js'
import { deleteAgentIndex, insertAgentIndex } from '../db/repos/agents.js'
import { indexMemory } from '../db/repos/memories.js'
import { embedText } from '../memory/embed.js'
import { listMemoryFiles } from '../memory/files.js'
import { clearScheduleModel, listSchedules, markFired } from '../schedules/loader.js'
import { clearTriggerModel, deleteTrigger, listTriggers, rotateTriggerToken } from '../triggers/loader.js'
import { agentConfigSchema, type AgentConfig } from './types.js'
import { activateAutomations } from './automations.js'
import { hasPendingSetup } from './setup.js'
import { ARCHIVE_LIMITS, ARCHIVE_ROOTS, MANIFEST_PATH, mcpAuthServers, registryConnectorSlugs, requiredEnvKeys } from './archive.js'
import { VAULT_SKILLS_MARKER } from '../vault/skills.js'
import { readRegistry } from '../services/registry.js'
import { parseEnvFile, writeAgentEnv } from './env.js'
import { writeAgentConfig } from './config-write.js'
import { loadAgentFromDisk } from './loader.js'
import { defaultSoul } from './soul.js'

// The mirror of `buildArchive`. What matters here is that the tarball is untrusted input: it
// travelled through a bucket and arrives over HTTP, so extraction re-applies the capture's own
// allowlist rather than trusting what the entries claim to be. `mcp/` and `data/system.db` stay
// out on the way in for the same reason they stayed out on the way out, and every webhook token
// the tarball carries is reissued rather than trusted.
//
// Split by kind, because the same prefix match on both would let an archive plant a directory
// where the engine expects a file: `data/agent.db/x` passes a `data/agent.db/` prefix test, and
// the copy's database is then a folder every `db_*` call fails on.
const FILE_ROOTS = new Set<string>([...ARCHIVE_ROOTS.filter(root => root.includes('.')), MANIFEST_PATH])
const DIR_ROOTS = ARCHIVE_ROOTS.filter(root => !FILE_ROOTS.has(root))

// An entry count no honest capture reaches. Rejected entries cost nothing to unpack but do cost
// a line in `skipped`, so a tarball of a million empty headers would otherwise be a free way to
// exhaust the engine's heap.
const MAX_ENTRIES = 100_000
const MAX_SKIPPED_REPORTED = 100

// Same device as the agent folder, so the staging directory becomes the agent folder with a
// rename rather than a copy. Outside `agents/` so a half-extracted folder is never scanned as an
// agent.
const importsDir = () => resolve(dataDir(), '.imports')

function isAllowed(path: string, isDirectory: boolean): boolean {
    // Names the source box's Vault items: the skills it listed arrive as the copy's own.
    if (path === `skills/${VAULT_SKILLS_MARKER}`) return false
    if (FILE_ROOTS.has(path)) return !isDirectory
    if (DIR_ROOTS.some(root => path === root || path.startsWith(`${root}/`))) return true
    // A directory only because it is on the way to a file root, e.g. `data` above `data/agent.db`.
    return isDirectory && [...FILE_ROOTS].some(root => root.startsWith(`${path}/`))
}

function normalizeEntryPath(path: string): string {
    return path.replace(/^\.?\//, '').replace(/\/+$/, '')
}

type ExtractOutcome = { skipped: string[] }

async function extractArchive(tarball: string, staging: string): Promise<ExtractOutcome> {
    const skipped: string[] = []
    let extractedBytes = 0
    let entries = 0
    let refusal: string | null = null

    // Never thrown from: node-tar calls the filter synchronously from its own header parser, with
    // no try/catch on the way, so a throw here escapes `extract()` entirely and takes the process
    // down instead of failing the request. A ceiling breach is recorded and re-raised after.
    const refuse = (reason: string) => {
        refusal ??= reason
        return false
    }

    try {
        await extract({
            file: tarball,
            cwd: staging,
            // `preservePaths` stays off so tar itself refuses absolute paths and `..`, and the
            // filter refuses everything else: a link of any kind, an unlisted root, a file over
            // the capture's own ceiling, or a payload that only expands past it once unpacked.
            filter: (path, entry) => {
                if (refusal) return false
                if (++entries > MAX_ENTRIES) return refuse(`This archive holds more than ${MAX_ENTRIES} entries.`)

                const rel = normalizeEntryPath(path)
                if (!rel) return true
                // `Stats` is the shape tar passes when creating; extraction always hands over a
                // `ReadEntry`, which is the only one carrying the entry type.
                const type = 'type' in entry ? entry.type : 'File'
                const isDirectory = type === 'Directory'

                const keep = (isDirectory || type === 'File') && !rel.split('/').includes('..') && isAllowed(rel, isDirectory) && entry.size <= ARCHIVE_LIMITS.maxFileBytes
                if (!keep) {
                    if (skipped.length < MAX_SKIPPED_REPORTED) skipped.push(rel)
                    return false
                }

                extractedBytes += entry.size
                if (extractedBytes > ARCHIVE_LIMITS.maxTotalBytes) return refuse(`This archive unpacks to more than ${ARCHIVE_LIMITS.maxTotalBytes / 1024 / 1024} MB.`)
                return true
            },
        })
    } catch (err) {
        throw badRequest(`This archive could not be unpacked: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    if (refusal) throw badRequest(refusal)

    return { skipped }
}

// `scrubConfig` handed the source agent id back as `${agent.id}` on the way out. The engine's own
// resolver rejects the dot, so the substitution is the importer's job, exactly as it is the UI
// compiler's at install time.
function rebindAgentId(config: AgentConfig, id: string): AgentConfig {
    const bind = (value: string) => value.replaceAll('${agent.id}', id)
    const bindRecord = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, bind(value)]))

    const mcpServers: McpServer[] = config.mcpServers.map(server => ({
        ...server,
        ...(server.command === undefined ? {} : { command: bind(server.command) }),
        ...(server.url === undefined ? {} : { url: bind(server.url) }),
        args: server.args.map(bind),
        env: bindRecord(server.env),
        headers: bindRecord(server.headers),
    }))

    return { ...config, mcpServers }
}

async function readConfig(staging: string, id: string, name: string, displayName: string): Promise<AgentConfig> {
    const path = resolve(staging, 'config.json')
    if (!existsSync(path)) throw badRequest('This archive has no config.json and is not an agent folder')
    let parsed: AgentConfig
    try {
        parsed = agentConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (err) {
        throw badRequest(`This archive carries a config.json the engine cannot read: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
    // The source agent was marked set up by its author, who never had to install it. A copy has
    // not been through its own INSTALL.md yet, so it starts pending again, in no conversation.
    const setup = { ...parsed.setup, completedAt: null, sessionId: null }
    // The pair the author ran on belongs to their box, not to this one: their pinned model may cost
    // ten times what this owner picked, or not be offered here at all. All three fields go, which is
    // what `followBoxDefault` writes when someone asks for the box default by hand, and it leaves a
    // copy exactly where an agent created from scratch starts.
    // Spending credit without asking is the source owner's choice for their own workspace: the
    // copy asks its new owner first, whatever an archive made before the scrub says.
    return rebindAgentId({ ...parsed, kind: 'user', name, displayName: displayName || parsed.displayName, setup, connectionId: null, provider: null, model: null, paidDataAlwaysAllow: false }, id)
}

async function readManifestMcpAuth(id: string): Promise<AgentArchiveMcpAuth[] | null> {
    const path = resolve(agentDir(id), MANIFEST_PATH)
    if (!existsSync(path)) return null
    try {
        const manifest = JSON.parse(await readFile(path, 'utf8')) as { mcpAuth?: AgentArchiveMcpAuth[] }
        return Array.isArray(manifest.mcpAuth) ? manifest.mcpAuth : null
    } catch {
        return null
    }
}

// The archive carries `memory/*.md` but not the index that makes them recallable: it lives in
// `data/system.db`, which never travels. Without this pass the copy holds memories it cannot
// find. An embedding failure is not fatal, full-text recall still works.
//
// Batched, because the embedding is a network hop with a 5 second timeout of its own and the
// import response waits on the whole pass: an agent with a few hundred memories would otherwise
// hold the request open long past the caller's budget.
const REINDEX_BATCH = 8

export async function reindexMemories(id: string): Promise<number> {
    const files = await listMemoryFiles(id).catch(() => [])
    let indexed = 0

    for (let i = 0; i < files.length; i += REINDEX_BATCH) {
        const batch = files.slice(i, i + REINDEX_BATCH)
        const embeddings = await Promise.all(batch.map(file => embedText(file.content).catch(() => null)))
        for (const [offset, file] of batch.entries()) {
            try {
                await indexMemory({ id: file.id, agentId: id, path: file.path, content: file.content, kind: file.kind, createdAt: file.createdAt, lastAccessedAt: file.createdAt, accessCount: 0 }, embeddings[offset])
                indexed += 1
            } catch (err) {
                logger.warn({ agentId: id, memoryId: file.id, err: String(err) }, 'memory reindex failed')
            }
        }
    }

    return indexed
}

// A copied schedule brings its `lastRunAt` with it, which the scheduler reads as its cron
// baseline: left alone, every schedule the source ever ran is already overdue the moment the copy
// lands and fires within a tick. Marking them as just fired keeps them enabled as captured and
// moves the first run to the next time they are genuinely due. A one-shot whose moment has passed
// is retired the same way, rather than firing once on arrival.
//
// `clearModel` is what separates an import from a duplication. A schedule names a connection and a
// model of its own; an archive's belong to the box its author ran on, so they go, for every
// schedule rather than only the timed ones, and a manual schedule is not left as the one place the
// template's model still lives. A copy staying on the same box keeps them: they are still valid.
export async function rebaselineSchedules(id: string, clearModel: boolean): Promise<string[]> {
    const slugs: string[] = []
    for (const schedule of await listSchedules(id).catch(() => [])) {
        if (clearModel) await clearScheduleModel(id, schedule.slug).catch(err => logger.warn({ agentId: id, schedule: schedule.slug, err: String(err) }, 'schedule model reset failed'))
        // A manual schedule has no clock of its own, so it is neither rebaselined nor reported: a
        // copy carrying one starts nothing on its own account.
        if (!schedule.cron && !schedule.runAt) continue
        slugs.push(schedule.slug)
        await markFired(id, schedule.slug, nowIso()).catch(err => logger.warn({ agentId: id, schedule: schedule.slug, err: String(err) }, 'schedule rebaseline failed'))
    }
    return slugs
}

// A webhook URL is a capability: whoever holds it fires the agent, and the token is also how the
// engine tells one trigger from another. Both callers reissue it unconditionally, for reasons that
// happen to coincide. An import must: the tarball is untrusted input, and one carrying a token its
// author kept a copy of would hand them a live URL on somebody else's account. A duplication must
// too: two triggers answering to the same secret is at best an ambiguous URL.
//
// `clearModel` follows `rebaselineSchedules`, for the same reason.
export async function rotateTriggers(id: string, clearModel: boolean): Promise<string[]> {
    const slugs: string[] = []
    for (const trigger of await listTriggers(id).catch(() => [])) {
        try {
            if (clearModel) await clearTriggerModel(id, trigger.slug)
            await rotateTriggerToken(id, trigger.slug)
            slugs.push(trigger.slug)
        } catch (err) {
            // Whatever token the archive carried is still on disk, so the trigger goes rather than
            // stays: an unreachable webhook is a nuisance, one answering to a secret somebody else
            // knows is a way in.
            logger.error({ agentId: id, trigger: trigger.slug, err: String(err) }, 'trigger token remint failed, dropping the trigger')
            await deleteTrigger(id, trigger.slug).catch(() => {})
        }
    }
    return slugs
}

export type ImportAgentInput = {
    body: ReadableStream<Uint8Array>
    name: string
    displayName?: string
}

export async function importAgent(input: ImportAgentInput): Promise<AgentImportResult> {
    const id = newId()
    await mkdir(importsDir(), { recursive: true })
    const scratch = await mkdtemp(resolve(importsDir(), 'import-'))
    const tarball = resolve(scratch, 'archive.tar.gz')
    const staging = resolve(scratch, 'agent')

    try {
        await mkdir(staging, { recursive: true })
        await pipeline(Readable.fromWeb(input.body as Parameters<typeof Readable.fromWeb>[0]), capAt(ARCHIVE_LIMITS.maxTotalBytes, max => `An agent archive cannot exceed ${max / 1024 / 1024} MB.`), createWriteStream(tarball))
        const { skipped } = await extractArchive(tarball, staging)

        const config = await readConfig(staging, id, input.name, input.displayName ?? '')
        const env = await readStagedEnv(staging)

        await mkdir(agentsDir(), { recursive: true })
        await rename(staging, agentDir(id))

        await mkdir(workspaceDir(id), { recursive: true })
        await mkdir(skillsDir(id), { recursive: true })
        await mkdir(resolve(agentDir(id), 'memory'), { recursive: true })
        await writeAgentConfig(id, config)
        if (!existsSync(soulPath(id))) await writeFile(soulPath(id), defaultSoul(config), 'utf8')
        // Rewritten rather than left as extracted: tar restores the archived mode, and the copy's
        // `.env` deserves the same 0600 a freshly created agent gets.
        await writeAgentEnv(id, env)
        await rebaselineSchedules(id, true)
        const triggers = await rotateTriggers(id, true)

        const agent = await loadAgentFromDisk(id)
        // An agent with nothing to install is already as configured as it will ever be, so its
        // automations start now rather than waiting for a setup conversation that never happens.
        if (!hasPendingSetup(agent)) await activateAutomations(agent)

        const registry = await readRegistry(id)
        const result = agentImportResultSchema.parse({
            id,
            name: config.name,
            displayName: config.displayName ?? '',
            description: config.description,
            soul: agent.soul,
            envKeys: requiredEnvKeys(agent),
            mcpAuth: (await readManifestMcpAuth(id)) ?? (await mcpAuthServers(id, registry)),
            connectorSlugs: registryConnectorSlugs(registry),
            triggers,
            memoriesIndexed: await reindexMemories(id),
            skippedPaths: skipped,
        })

        // Last, as in `createAgent`: nothing may fail after the index row exists, or the engine
        // would list an agent whose folder the rollback below has already removed.
        await insertAgentIndex(id, config.name)
        return result
    } catch (err) {
        await deleteAgentIndex(id).catch(() => {})
        await rm(agentDir(id), { recursive: true, force: true })
        throw err
    } finally {
        await rm(scratch, { recursive: true, force: true })
    }
}

// `existsSync` answers true for a directory too, and a hostile archive is exactly where a `.env`
// that is not a file comes from. A folder there means no keys, not a failed import.
async function readStagedEnv(staging: string): Promise<Record<string, string>> {
    try {
        return parseEnvFile(await readFile(resolve(staging, '.env'), 'utf8'))
    } catch {
        return {}
    }
}
