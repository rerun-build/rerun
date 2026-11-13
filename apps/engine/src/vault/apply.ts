import { agentExists, listAgentIdsOnDisk, readAgentConfig } from '../agents/loader.js'
import { releaseAgentMcp } from '../tools/mcp-pool.js'
import { agentMcpServers } from './runtime.js'
import { syncVaultSkills } from './skills.js'

// What every coworker touched by a change of the Vault needs at once: the skills of what it now
// holds in its folder, and the connections to servers it no longer holds closed rather than left to
// idle out. Servers, variables and tokens need nothing more: a run reads them from the Vault.
export async function applyVaultChange(agentIds: Iterable<string>): Promise<void> {
    for (const agentId of new Set(agentIds)) {
        if (!agentExists(agentId)) continue
        await syncVaultSkills(agentId)
        const config = await readAgentConfig(agentId).catch(() => null)
        if (config) releaseAgentMcp(agentId, agentMcpServers({ id: agentId, config }).map(server => server.name))
    }
}

// On boot: a Vault restored from an archive, or edited by an engine that stopped half way, is
// written out again into every coworker's folder.
export async function reconcileVault(): Promise<void> {
    await applyVaultChange(await listAgentIdsOnDisk())
}
