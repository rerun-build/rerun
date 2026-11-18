import { mkdirSync } from 'node:fs'
import { agentDataDbPath, agentDataDir, sharedDbDir, sharedDbPath, workspaceDir } from '../config/paths.js'
import type { LoadedAgent } from './types.js'
import { readSharedEnvSync } from './shared-env.js'

export type AgentProcessEnv = { cwd: string; env: Record<string, string> }

export function sharedProcessEnv(): Record<string, string> {
    return readSharedEnvSync()
}

export function agentProcessEnv(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>, labels?: Record<string, string>): AgentProcessEnv {
    const cwd = workspaceDir(agent.id)
    mkdirSync(cwd, { recursive: true })
    mkdirSync(agentDataDir(agent.id), { recursive: true })
    const env: Record<string, string> = { ...readSharedEnvSync(), ...agent.env, ...labels, RERUN_AGENT_DB: agentDataDbPath(agent.id), RERUN_WORKSPACE: cwd }
    if (agent.config.tools.sharedDb) {
        mkdirSync(sharedDbDir(), { recursive: true })
        env.RERUN_SHARED_DB = sharedDbPath()
    }
    return { cwd, env }
}
