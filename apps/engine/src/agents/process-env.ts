import { mkdirSync } from 'node:fs'
import { agentDataDbPath, agentDataDir, sharedDbDir, sharedDbPath, workspaceDir } from '../config/paths.js'
import type { LoadedAgent } from './types.js'

export type AgentProcessEnv = { cwd: string; env: Record<string, string> }

// What every process an agent starts must see, whether shell_exec spawns it or a CLI provider's
// own shell does: the agent's .env plus the paths the system prompt names. The base is left to the
// caller: `childProcessEnv` in lib/child-env.ts for the engine's own spawns, the provider's own
// allowlist for Claude. Nothing here or there carries the engine's configuration.
export function agentProcessEnv(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>): AgentProcessEnv {
    const cwd = workspaceDir(agent.id)
    mkdirSync(cwd, { recursive: true })
    mkdirSync(agentDataDir(agent.id), { recursive: true })
    const env: Record<string, string> = { ...agent.env, RERUN_AGENT_DB: agentDataDbPath(agent.id), RERUN_WORKSPACE: cwd }
    if (agent.config.tools.sharedDb) {
        mkdirSync(sharedDbDir(), { recursive: true })
        env.RERUN_SHARED_DB = sharedDbPath()
    }
    return { cwd, env }
}
