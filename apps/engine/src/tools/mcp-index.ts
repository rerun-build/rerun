import { mcpToolNameFor, resolveTransport } from './mcp.js'
import { MCP_CALL_TOOL, MCP_SEARCH_TOOL, mcpServerToolCounts, type McpCatalogEntry } from './mcp-search.js'
import { loadToken, serverCarriesCredential } from './mcp-auth.js'
import { connectorServerStates, type ConnectorServerState } from '../services/registry.js'
import type { Provider } from '@moldwright/contracts'
import type { LoadedAgent } from '../agents/types.js'

export function describeConnectorState(state: ConnectorServerState, states: Map<string, ConnectorServerState>): string {
    const parts = [`app "${state.slug}"`]
    if (state.label) parts.push(`account ${state.label}`)
    if (state.isDefault && hasOtherInstances(state, states)) parts.push('default account')
    return parts.join(', ')
}

function hasOtherInstances(state: ConnectorServerState, states: Map<string, ConnectorServerState>): boolean {
    for (const other of states.values()) if (other.slug === state.slug && other.key !== state.key) return true
    return false
}

function connectorAuth(state: ConnectorServerState, states: Map<string, ConnectorServerState>): string {
    const app = describeConnectorState(state, states)
    if (state.status === 'needs_auth') return `not connected yet (${app})`
    if (state.status === 'needs_config') return `not set up yet (${app})`
    return `connected (${app})`
}

export async function buildMcpIndex(agent: LoadedAgent, provider?: Provider, heldBack?: McpCatalogEntry[]): Promise<string> {
    if (agent.config.mcpServers.length === 0) return ''
    const states = await connectorServerStates(agent.id)
    const toolCounts = heldBack ? mcpServerToolCounts(heldBack) : null
    const { enabled, allowToolInstall } = agent.config.selfImprovement
    const signInStep = enabled && allowToolInstall ? 'call request_mcp_sign_in with its name and end your turn' : 'ask the user to connect it from the Apps panel of this coworker'
    const lines = await Promise.all(
        agent.config.mcpServers.map(async server => {
            const transport = resolveTransport(server)
            const state = states.get(server.name)
            let auth = transport === 'stdio' ? 'local command' : serverCarriesCredential(server) ? 'authenticated with a key in its url' : `not signed in — if its tools answer that sign-in is required, ${signInStep}`
            if (state) auth = connectorAuth(state, states)
            else if (Object.keys(server.headers).length > 0) auth = 'authenticated via request headers'
            else if (await loadToken(agent.id, server.name).catch(() => null)) auth = 'authenticated (OAuth)'
            return `- ${server.name} (${transport}): ${auth}${toolCounts ? `, ${toolCounts.get(server.name) ?? 0} tools` : ''}`
        }),
    )
    const pending = agent.config.mcpServers.some(server => {
        const status = states.get(server.name)?.status
        return status !== undefined && status !== 'active'
    })
    const connectStep = agent.config.tools.suggestService
        ? 'when the next step needs it, call suggest_service with its app slug and end your turn'
        : 'when the next step needs it, ask the user to connect it from the Apps panel of this coworker'
    const pendingNote = pending
        ? ` A server marked "not connected yet" or "not set up yet" belongs to an app the user has not connected: its tools are listed but every call fails, so do not call them and never tell the user that app is connected; ${connectStep}.`
        : ''
    const toolName = `\`${mcpToolNameFor(provider, '<name>', '<tool>')}\``
    const reaching = heldBack
        ? `Their tools are named ${toolName} and are not in your tool list: call ${MCP_SEARCH_TOOL} with a few words of what you need and the server's name to get their names and input schemas, then run one with ${MCP_CALL_TOOL}. A schema you already got in this conversation still holds: search again only for a tool whose schema is no longer in it.`
        : `Their tools are loaded as ${toolName}.`
    return `These MCP servers are already configured. ${reaching} For a server marked connected or authenticated, do NOT claim you lack credentials or session info; just call the tools.${pendingNote} Check live status with mcp_status.\n\n${lines.join('\n')}`
}
