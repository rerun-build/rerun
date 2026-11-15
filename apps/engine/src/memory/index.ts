import { listMemoryFiles } from './files.js'
import { computeStrength, memoryStatus } from './decay.js'
import { listMemories } from '../db/repos/memories.js'

function headline(content: string): string {
    const line =
        content
            .split('\n')
            .map(l => l.trim())
            .find(l => l.length > 0) ?? ''
    return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

export async function buildMemoryIndex(agentId: string): Promise<string> {
    const [files, rows] = await Promise.all([listMemoryFiles(agentId), listMemories(agentId).catch(() => [])])
    if (files.length === 0) return ''
    const statsById = new Map(rows.map(r => [r.id, r]))
    const active = files.filter(f => {
        const stats = statsById.get(f.id)
        if (!stats) return true
        return memoryStatus(computeStrength(stats)) === 'active'
    })
    const dormantCount = files.length - active.length
    const lines = active
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map(f => `- (${f.kind}) ${headline(f.content)}`)
    const dormantNote = dormantCount > 0 ? `\n\n${dormantCount} dormant ${dormantCount === 1 ? 'memory is' : 'memories are'} not listed; pass includeDormant to memory_recall to search them.` : ''
    if (lines.length === 0 && dormantCount === 0) return ''
    return `This is an index of everything you have remembered. It tells you what you know, not the full detail. When a request touches anything listed here, call memory_recall to fetch the full content before answering.\n\n${lines.join('\n')}${dormantNote}`
}
