import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { agentsDir, configPath, installPath, soulPath } from '../config/paths.js'
import { resolveConfiguredModel } from './availability.js'
import { agentConfigSchema, type AgentConfig, type LoadedAgent } from './types.js'
import { readAgentEnv } from './env.js'

export function agentExists(id: string): boolean {
    return existsSync(configPath(id))
}

export async function readAgentConfig(id: string): Promise<AgentConfig> {
    return agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
}

export async function loadAgentView(id: string): Promise<Omit<LoadedAgent, 'env'>> {
    const config = await readAgentConfig(id)
    const soul = existsSync(soulPath(id)) ? await readFile(soulPath(id), 'utf8') : ''
    const install = existsSync(installPath(id)) ? await readFile(installPath(id), 'utf8') : ''
    const resolved = await resolveConfiguredModel(config)
    return { id, config, soul, install, resolved }
}

export async function loadAgentFromDisk(id: string): Promise<LoadedAgent> {
    const [view, env] = await Promise.all([loadAgentView(id), readAgentEnv(id)])
    return { ...view, env }
}

export async function listAgentIdsOnDisk(): Promise<string[]> {
    const root = agentsDir()
    if (!existsSync(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && existsSync(configPath(e.name))).map(e => e.name)
}
