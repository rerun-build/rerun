import { mcpToolNameFor, resolveTransport } from './mcp.js'
import { tokenSlotFor } from './mcp-auth.js'
import { connectorServerStates, type ConnectorServerState } from '../services/registry.js'
import type { Provider } from '@rerun/contracts'
import type { LoadedAgent } from '../agents/types.js'
import { agentMcpServers, vaultServerStates } from '../vault/runtime.js'

// Names the app behind a server, and which of its accounts when the agent holds several or the
// account has a label, so the model can pick the right server for "the support inbox".
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

// A catalog app's server reaches the hub with request headers whether or not the user connected
// the account behind it, so for those the registry status is the only truthful answer.
function connectorAuth(state: ConnectorServerState, states: Map<string, ConnectorServerState>): string {
    const app = describeConnectorState(state, states)
    if (state.status === 'needs_auth') return `not connected yet (${app})`
    if (state.status === 'needs_config') return `not set up yet (${app})`
    return `connected (${app})`
}

// The Vault's servers and states are layered over the coworker's own: an item wins over the copy of
// a connector a migration left in the coworker's folder.
export async function agentConnectorStates(agent: Pick<LoadedAgent, 'id' | 'config' | 'hubAgentId'>): Promise<Map<string, ConnectorServerState>> {
    return new Map([...(await connectorServerStates(agent.id)), ...vaultServerStates(agent)])
}

export async function buildMcpIndex(agent: LoadedAgent, provider?: Provider): Promise<string> {
    const servers = agentMcpServers(agent)
    if (servers.length === 0) return ''
    const states = await agentConnectorStates(agent)
    const lines = await Promise.all(
        servers.map(async server => {
            const transport = resolveTransport(server)
            const state = states.get(server.name)
            let auth = 'not authenticated — call mcp_login if its tools fail'
            if (state) auth = connectorAuth(state, states)
            else if (Object.keys(server.headers).length > 0) auth = 'authenticated via request headers'
            else if (await tokenSlotFor(agent.id, server).load().catch(() => null)) auth = 'authenticated (OAuth)'
            return `- ${server.name} (${transport}): ${auth}`
        }),
    )
    const pending = servers.some(server => {
        const status = states.get(server.name)?.status
        return status !== undefined && status !== 'active'
    })
    const connectStep = agent.config.tools.suggestService
        ? 'when the next step needs it, call suggest_service with its app slug and end your turn'
        : 'when the next step needs it, ask the user to connect it from the Apps panel of this coworker'
    const pendingNote = pending
        ? ` A server marked "not connected yet" or "not set up yet" belongs to an app the user has not connected: its tools are listed but every call fails, so do not call them and never tell the user that app is connected; ${connectStep}.`
        : ''
    return `These MCP servers are already configured. Their tools are loaded as \`${mcpToolNameFor(provider, '<name>', '<tool>')}\`. For a server marked connected or authenticated, do NOT claim you lack credentials or session info; just call the tools.${pendingNote} Check live status with mcp_status.\n\n${lines.join('\n')}`
}
