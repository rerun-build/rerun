import { serviceRegistryKey } from '@rerun/contracts'
import type { LoadedAgent } from '../agents/types.js'
import type { RegistryEntry, ServiceRegistry } from '../services/registry.js'
import { agentMcpServers, attachedVaultItems, vaultEnvFor } from './runtime.js'
import type { LoadedVaultItem } from './types.js'

// A coworker as an archive carries it: what it draws on from the Vault folded into its own config,
// `.env` and connector registry, as if it held all of it itself. The box that reads the archive has
// no Vault of ours to point to, so nothing here names an item; the archive's own redaction then
// empties every value and puts every account back to needs_auth, as it does for the coworker's own.

export function withVaultFolded(agent: LoadedAgent): LoadedAgent {
    const mcpServers = agentMcpServers(agent).map(({ vaultItemId: _item, ...server }) => server)
    return { ...agent, env: { ...agent.env, ...vaultEnvFor(agent) }, config: { ...agent.config, mcpServers } }
}

function registryEntryOf(item: LoadedVaultItem): RegistryEntry {
    const { config } = item
    return {
        status: config.status,
        ...(config.label ? { label: config.label } : {}),
        ...(config.instanceId ? { instanceId: config.instanceId } : {}),
        mcpServers: config.mcpServers.map(server => server.name),
        envKeys: Object.keys(item.env).sort(),
        skills: config.skills.map(skill => skill.slug),
        ...(config.oauth ? { oauth: config.oauth } : {}),
        ...(config.managed ? { managed: config.managed } : {}),
        ...(config.composio ? { composio: config.composio } : {}),
        ...(config.app ? { app: config.app } : {}),
    }
}

// The coworker's own entry wins on a shared key: it is the copy a migration left behind.
export function registryWithVault(agent: Pick<LoadedAgent, 'id' | 'config'>, registry: ServiceRegistry | null): ServiceRegistry | null {
    const items = attachedVaultItems(agent).filter(item => item.config.kind === 'service' && item.config.slug)
    if (items.length === 0) return registry
    const services: Record<string, RegistryEntry> = { ...(registry?.services ?? {}) }
    for (const item of items) {
        const key = serviceRegistryKey(item.config.slug as string, item.config.instanceId)
        services[key] ??= registryEntryOf(item)
    }
    return { ...(registry ?? {}), services }
}
