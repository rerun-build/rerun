import type { LoadedAgent, McpServer } from '../agents/types.js'
import type { ConnectorServerState } from '../services/registry.js'
import { vaultItemsForAgent } from './store.js'
import type { LoadedVaultItem } from './types.js'

// A server a run got from the Vault rather than from the coworker's own config. The tag only lives
// in memory, between the list and `prepareMcpServer`, which takes it off before anything dials.
export type AgentMcpServer = McpServer & { vaultItemId?: string }

type VaultHolder = Pick<LoadedAgent, 'id' | 'config'> & { hubAgentId?: string }

// The coworker whose Vault a run draws on: itself, or the coworker a delegate works for. The
// foreman installs connectors for others and holds none of them.
export function vaultAgentId(agent: VaultHolder): string | null {
    if (agent.config.kind === 'foreman') return null
    return agent.hubAgentId ?? agent.id
}

export function attachedVaultItems(agent: VaultHolder): LoadedVaultItem[] {
    const id = vaultAgentId(agent)
    return id ? vaultItemsForAgent(id) : []
}

// The variables of every attached item, for the coworker's shell. They win over the coworker's own
// `.env`: the Vault is where the workspace keeps the value it means today. Two attached items never
// set the same one, the attachment refuses it. A server of the coworker's own never reads them.
export function vaultEnvFor(agent: VaultHolder): Record<string, string> {
    return Object.assign({}, ...attachedVaultItems(agent).map(item => item.env)) as Record<string, string>
}

// The servers a run dials: those of the attached items, then the coworker's own. One of its own
// under a name an item also carries is the copy a migration left behind, and the item wins.
export function agentMcpServers(agent: VaultHolder): AgentMcpServer[] {
    const fromVault = attachedVaultItems(agent).flatMap(item => item.config.mcpServers.map(server => ({ ...server, vaultItemId: item.id })))
    const taken = new Set(fromVault.map(server => server.name))
    return [...fromVault, ...agent.config.mcpServers.filter(server => !taken.has(server.name))]
}

// Where the setup of each Vault server stands, in the shape a coworker's own connectors report it.
// A catalog app always says; a custom server only once it waits on something, otherwise its
// headers or its token tell the model how it signs in.
export function vaultServerStates(agent: VaultHolder): Map<string, ConnectorServerState> {
    const states = new Map<string, ConnectorServerState>()
    for (const item of attachedVaultItems(agent)) {
        if (item.config.kind !== 'service' && item.config.status === 'active') continue
        const state: ConnectorServerState = {
            key: `vault:${item.id}`,
            slug: item.config.slug ?? item.config.name,
            ...(item.config.label ? { label: item.config.label } : {}),
            status: item.config.status,
            isDefault: !item.config.instanceId,
        }
        for (const server of item.config.mcpServers) states.set(server.name, state)
    }
    return states
}
