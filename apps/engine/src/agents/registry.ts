import { agentExists, loadAgentFromDisk } from './loader.js'
import type { LoadedAgent } from './types.js'
import { notFound } from '../lib/errors.js'
import { releaseAgentMcp } from '../tools/mcp-pool.js'

const cache = new Map<string, LoadedAgent>()

export async function getAgent(id: string): Promise<LoadedAgent> {
    const cached = cache.get(id)
    if (cached) return cached
    if (!agentExists(id)) throw notFound('agent')
    const agent = await loadAgentFromDisk(id)
    cache.set(id, agent)
    return agent
}

export function unloadAgent(id: string): void {
    cache.delete(id)
    releaseAgentMcp(id)
}

export function clearAgentCache(): void {
    cache.clear()
}

export async function reloadAgent(id: string): Promise<LoadedAgent> {
    cache.delete(id)
    const agent = await getAgent(id)
    const declared = agent.config.mcpServers.map(server => server.name)
    releaseAgentMcp(id, declared)
    return agent
}

export function activeAgentCount(): number {
    return cache.size
}
