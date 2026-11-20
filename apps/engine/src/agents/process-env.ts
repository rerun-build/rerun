import { mkdirSync } from 'node:fs'
import { agentDataDbPath, agentDataDir, sharedDbDir, sharedDbPath, workspaceDir } from '../config/paths.js'
import type { LoadedAgent } from './types.js'
import { vaultEnvFor } from '../vault/runtime.js'

export type AgentProcessEnv = { cwd: string; env: Record<string, string> }

type VariableHolder = Pick<LoadedAgent, 'id' | 'env' | 'config' | 'hubAgentId'>

// The Vault wins over the coworker's own `.env`: it holds the value the workspace means today.
export function agentVariables(agent: VariableHolder): Record<string, string> {
    return { ...agent.env, ...vaultEnvFor(agent) }
}

// Debian marks its Python as externally managed (PEP 668), so a plain `pip install` is refused and
// the coworker gave up on the library it needed (RER-178). On a box, without root, pip then falls
// back to the user's own site. The coworker's `.env` can override it.
const COWORKER_DEFAULTS: Record<string, string> = { PIP_BREAK_SYSTEM_PACKAGES: '1' }

// What every process an agent starts must see, whether shell_exec spawns it or a CLI provider's
// own shell does: the agent's .env plus the paths the system prompt names. The base is left to the
// caller: `childProcessEnv` in lib/child-env.ts for the engine's own spawns, the provider's own
// allowlist for Claude. Nothing here or there carries the engine's configuration. The secrets of the
// Vault items attached to the coworker are its variables too, as they were in its own `.env`.
//
// `vault: false` leaves them out, for an MCP server: one of the coworker's own servers never needed
// them, and a Vault server gets its own item's variables and no other's.
export function agentProcessEnv(agent: VariableHolder, { vault = true }: { vault?: boolean } = {}): AgentProcessEnv {
    const cwd = workspaceDir(agent.id)
    mkdirSync(cwd, { recursive: true })
    mkdirSync(agentDataDir(agent.id), { recursive: true })
    const env: Record<string, string> = { ...COWORKER_DEFAULTS, ...(vault ? agentVariables(agent) : agent.env), RERUN_AGENT_DB: agentDataDbPath(agent.id), RERUN_WORKSPACE: cwd }
    if (agent.config.tools.sharedDb) {
        mkdirSync(sharedDbDir(), { recursive: true })
        env.RERUN_SHARED_DB = sharedDbPath()
    }
    return { cwd, env }
}
