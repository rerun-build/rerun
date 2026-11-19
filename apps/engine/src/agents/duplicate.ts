import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { agentDuplicateResultSchema, type AgentDuplicateResult, type DuplicateAgentInput, type McpServer } from '@moldwright/contracts'
import { agentDir, agentsDir, dataDir, skillsDir, soulPath, workspaceDir } from '../config/paths.js'
import { newId } from '../lib/ids.js'
import { badRequest } from '../lib/errors.js'
import { deleteAgentIndex, insertAgentIndex } from '../db/repos/agents.js'
import { checkpointAgentDb } from '../db/agentDb.js'
import { withAgentLock } from './lock.js'
import { agentConfigSchema, type AgentConfig } from './types.js'
import { ARCHIVE_ROOTS, listPathsUnder } from './archive.js'
import { rebaselineSchedules, reindexMemories, rotateTriggers } from './import.js'
import { writeAgentConfig } from './config-write.js'
import { parseEnvFile, writeAgentEnv } from './env.js'
import { loadAgentFromDisk } from './loader.js'
import { defaultSoul } from './soul.js'

const DUPLICATE_ROOTS = [...ARCHIVE_ROOTS, 'mcp'] as const

const stagingRoot = () => resolve(dataDir(), '.imports')

function rebindAgentId(config: AgentConfig, from: string, to: string): AgentConfig {
    const bind = (value: string) => value.replaceAll(from, to)
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

async function copyPlan(sourceId: string): Promise<{ keep: Set<string>; keepDirs: Set<string> }> {
    const keep = new Set(await listPathsUnder(sourceId, DUPLICATE_ROOTS))
    const keepDirs = new Set<string>()
    for (const path of keep) {
        const parts = path.split('/')
        for (let i = 1; i < parts.length; i++) keepDirs.add(parts.slice(0, i).join('/'))
    }
    return { keep, keepDirs }
}

async function readStagedConfig(staging: string, id: string, sourceId: string, input: DuplicateAgentInput): Promise<AgentConfig> {
    const path = resolve(staging, 'config.json')
    if (!existsSync(path)) throw badRequest('This agent has no config.json and cannot be duplicated')
    let parsed: AgentConfig
    try {
        parsed = agentConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (err) {
        throw badRequest(`This agent carries a config.json the engine cannot read: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
    return rebindAgentId({ ...parsed, name: input.name, displayName: input.displayName || parsed.displayName, setup: { ...parsed.setup, sessionId: null } }, sourceId, id)
}

async function readStagedEnv(staging: string): Promise<Record<string, string>> {
    try {
        return parseEnvFile(await readFile(resolve(staging, '.env'), 'utf8'))
    } catch {
        return {}
    }
}

export async function duplicateAgent(sourceId: string, input: DuplicateAgentInput): Promise<AgentDuplicateResult> {
    const id = newId()
    await mkdir(stagingRoot(), { recursive: true })
    const scratch = await mkdtemp(resolve(stagingRoot(), 'duplicate-'))
    const staging = resolve(scratch, 'agent')

    try {
        const config = await withAgentLock(sourceId, async () => {
            await checkpointAgentDb(sourceId)
            const root = agentDir(sourceId)
            const { keep, keepDirs } = await copyPlan(sourceId)
            await cp(root, staging, {
                recursive: true,
                filter: source => {
                    const rel = relative(root, source).split(sep).join('/')
                    return !rel || keep.has(rel) || keepDirs.has(rel)
                },
            })
            return readStagedConfig(staging, id, sourceId, input)
        })

        const env = await readStagedEnv(staging)

        await mkdir(agentsDir(), { recursive: true })
        await rename(staging, agentDir(id))

        await mkdir(workspaceDir(id), { recursive: true })
        await mkdir(skillsDir(id), { recursive: true })
        await mkdir(resolve(agentDir(id), 'memory'), { recursive: true })
        await writeAgentConfig(id, config)
        if (!existsSync(soulPath(id))) await writeFile(soulPath(id), defaultSoul(config), 'utf8')
        await writeAgentEnv(id, env)

        const schedules = await rebaselineSchedules(id, false)
        const triggers = await rotateTriggers(id, false)

        const agent = await loadAgentFromDisk(id)

        const result = agentDuplicateResultSchema.parse({
            id,
            name: agent.config.name,
            displayName: agent.config.displayName ?? '',
            description: agent.config.description,
            schedules,
            triggers,
            memoriesIndexed: await reindexMemories(id),
        })

        await insertAgentIndex(id, agent.config.name)
        return result
    } catch (err) {
        await deleteAgentIndex(id).catch(() => {})
        await rm(agentDir(id), { recursive: true, force: true })
        throw err
    } finally {
        await rm(scratch, { recursive: true, force: true })
    }
}
