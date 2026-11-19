import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extract } from 'tar'
import { agentImportResultSchema, type AgentArchiveMcpAuth, type AgentImportResult, type McpServer } from '@moldwright/contracts'
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
import { readRegistry } from '../services/registry.js'
import { parseEnvFile, writeAgentEnv } from './env.js'
import { writeAgentConfig } from './config-write.js'
import { loadAgentFromDisk } from './loader.js'
import { defaultSoul } from './soul.js'

const FILE_ROOTS = new Set<string>([...ARCHIVE_ROOTS.filter(root => root.includes('.')), MANIFEST_PATH])
const DIR_ROOTS = ARCHIVE_ROOTS.filter(root => !FILE_ROOTS.has(root))

const MAX_ENTRIES = 100_000
const MAX_SKIPPED_REPORTED = 100

const importsDir = () => resolve(dataDir(), '.imports')

function isAllowed(path: string, isDirectory: boolean): boolean {
    if (FILE_ROOTS.has(path)) return !isDirectory
    if (DIR_ROOTS.some(root => path === root || path.startsWith(`${root}/`))) return true
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

    const refuse = (reason: string) => {
        refusal ??= reason
        return false
    }

    try {
        await extract({
            file: tarball,
            cwd: staging,
            filter: (path, entry) => {
                if (refusal) return false
                if (++entries > MAX_ENTRIES) return refuse(`This archive holds more than ${MAX_ENTRIES} entries.`)

                const rel = normalizeEntryPath(path)
                if (!rel) return true
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
    const setup = { ...parsed.setup, completedAt: null, sessionId: null }
    return rebindAgentId({ ...parsed, kind: 'user', name, displayName: displayName || parsed.displayName, setup, connectionId: null, provider: null, model: null }, id)
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

export async function rebaselineSchedules(id: string, clearModel: boolean): Promise<string[]> {
    const slugs: string[] = []
    for (const schedule of await listSchedules(id).catch(() => [])) {
        if (clearModel) await clearScheduleModel(id, schedule.slug).catch(err => logger.warn({ agentId: id, schedule: schedule.slug, err: String(err) }, 'schedule model reset failed'))
        if (!schedule.cron && !schedule.runAt) continue
        slugs.push(schedule.slug)
        await markFired(id, schedule.slug, nowIso()).catch(err => logger.warn({ agentId: id, schedule: schedule.slug, err: String(err) }, 'schedule rebaseline failed'))
    }
    return slugs
}

export async function rotateTriggers(id: string, clearModel: boolean): Promise<string[]> {
    const slugs: string[] = []
    for (const trigger of await listTriggers(id).catch(() => [])) {
        try {
            if (clearModel) await clearTriggerModel(id, trigger.slug)
            await rotateTriggerToken(id, trigger.slug)
            slugs.push(trigger.slug)
        } catch (err) {
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
        await writeAgentEnv(id, env)
        await rebaselineSchedules(id, true)
        const triggers = await rotateTriggers(id, true)

        const agent = await loadAgentFromDisk(id)
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

async function readStagedEnv(staging: string): Promise<Record<string, string>> {
    try {
        return parseEnvFile(await readFile(resolve(staging, '.env'), 'utf8'))
    } catch {
        return {}
    }
}
