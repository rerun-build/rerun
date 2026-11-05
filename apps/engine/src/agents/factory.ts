import { mkdir, writeFile } from 'node:fs/promises'
import { agentDir, configPath, installPath, skillsDir, soulPath, workspaceDir } from '../config/paths.js'
import { resolve } from 'node:path'
import { newId } from '../lib/ids.js'
import { insertAgentIndex } from '../db/repos/agents.js'
import { agentConfigSchema, type AgentConfig, type LoadedAgent } from './types.js'
import { serializeEnv, writeAgentEnv } from './env.js'
import { defaultSoul } from './soul.js'
import { resolveConfiguredModel } from './availability.js'

export type CreateAgentInput = {
    config: Partial<AgentConfig> & { name: string }
    soul?: string
    install?: string
    keys?: Record<string, string>
}

export async function createAgent(input: CreateAgentInput): Promise<LoadedAgent> {
    const id = newId()
    const config = agentConfigSchema.parse({ ...input.config, kind: 'user' })
    const env = input.keys ?? {}
    // Refused keys must fail before the folder exists, or the agent is left on disk with no index row.
    serializeEnv(env)
    await mkdir(workspaceDir(id), { recursive: true })
    await mkdir(skillsDir(id), { recursive: true })
    await mkdir(resolve(agentDir(id), 'memory'), { recursive: true })
    const soul = input.soul ?? defaultSoul(config)
    const install = input.install?.trim() ?? ''
    await writeFile(configPath(id), JSON.stringify(config, null, 4), { encoding: 'utf8', mode: 0o600 })
    await writeFile(soulPath(id), soul, 'utf8')
    if (install.length > 0) await writeFile(installPath(id), `${install}\n`, 'utf8')
    await writeAgentEnv(id, env)
    await insertAgentIndex(id, config.name)
    const resolved = await resolveConfiguredModel(config)
    return { id, config, soul, install, env, resolved }
}
