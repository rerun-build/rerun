import type { AgentConfig, ForemanBrief, Provider } from '@moldwright/contracts'
import type { RunModel } from './availability.js'

export { mcpServerSchema, toolsSchema, selfImprovementSchema, agentSetupSchema, agentConfigSchema, verbositySchema, MCP_SERVER_NAME_RE } from '@moldwright/contracts'
export type { McpServer, AgentConfig, AgentSetup, Verbosity } from '@moldwright/contracts'

export const BRIDGE_SERVER_NAME = 'rerun'

export const CLI_PROVIDERS = new Set<Provider>(['claude', 'codex'])

export type LoadedAgent = {
    id: string
    config: AgentConfig
    soul: string
    install: string
    env: Record<string, string>
    resolved: RunModel
    brief?: ForemanBrief
    hubAgentId?: string
}
