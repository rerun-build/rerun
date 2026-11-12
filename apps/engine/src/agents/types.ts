import type { AgentConfig, ForemanBrief, Provider } from '@rerun/contracts'
import type { RunModel } from './availability.js'

export { mcpServerSchema, toolsSchema, selfImprovementSchema, agentSetupSchema, agentConfigSchema, verbositySchema, MCP_SERVER_NAME_RE } from '@rerun/contracts'
export type { McpServer, AgentConfig, AgentSetup, Verbosity } from '@rerun/contracts'

// The in-process MCP server both CLI providers expose Rerun's builtin tools under. A custom server
// registered under the same name would shadow it, so the provider drops it: the agent then shows
// the server in its config and holds none of its tools.
export const BRIDGE_SERVER_NAME = 'rerun'

// Providers that delegate the whole agentic loop to a local CLI: they run their own tools, so
// Rerun's tools reach them bridged as an MCP server rather than through the AI SDK `tools` param.
export const CLI_PROVIDERS = new Set<Provider>(['claude', 'codex'])

export type LoadedAgent = {
    id: string
    config: AgentConfig
    soul: string
    install: string
    // Agent-scoped secrets only: MCP server credentials, shell variables, connector keys. The
    // provider credentials moved to the box connection.
    env: Record<string, string>
    // What this agent runs when a run names nothing: its own pin, or the box default when
    // `config.model` is null. Refreshed by `clearAgentCache`, which every connection edit and every
    // box-default write triggers. Read this rather than `config.provider` / `config.model`, which
    // are the setting and may say nothing at all.
    resolved: RunModel
    // The foreman's instructions and tools for this one run, handed over by the hub with the chat
    // request. Never on disk, and absent on every other agent.
    brief?: ForemanBrief
    // The coworker the hub knows this agent as, when it is not itself: a delegate exists only on
    // the engine, so it calls the hub's apps as the coworker that spawned it. Set at runtime, never
    // read from the config, which the agent can edit.
    hubAgentId?: string
}
