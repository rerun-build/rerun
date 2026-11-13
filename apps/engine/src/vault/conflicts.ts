import type { VaultConflict } from '@rerun/contracts'
import { HttpError } from '../lib/errors.js'
import type { LoadedVaultItem } from './types.js'

export type VaultConflictEntry = VaultConflict['conflicts'][number]

type Footprint = Pick<LoadedVaultItem, 'id' | 'config' | 'env'>

// Every coworker both items reach. An item shared with everyone reaches any coworker the other one
// does, and also the coworkers not created yet: two items shared with everyone clash on an empty box
// as surely as on a full one, which `*` stands for.
function sharedAgents(a: Footprint, b: Footprint, allAgents: string[]): string[] {
    if (a.config.sharedWithAll && b.config.sharedWithAll) return ['*']
    if (a.config.sharedWithAll) return b.config.agentIds.filter(id => allAgents.includes(id))
    if (b.config.sharedWithAll) return a.config.agentIds.filter(id => allAgents.includes(id))
    return a.config.agentIds.filter(id => b.config.agentIds.includes(id))
}

const kindLabel = (kind: VaultConflictEntry['kind'], name: string) => (kind === 'env' ? `the variable ${name}` : kind === 'server' ? `an MCP server named "${name}"` : `a skill named "${name}"`)

export class VaultConflictError extends HttpError {
    readonly conflicts: VaultConflictEntry[]
    constructor(conflicts: VaultConflictEntry[]) {
        const first = conflicts[0]
        super(409, `This coworker already gets ${kindLabel(first.kind, first.name)} from another item of the Vault`, 'vault_conflict')
        this.conflicts = conflicts
    }
}

// A coworker holding two items that set the same variable, two servers under one name or two skills
// under one slug would get one of them at random: the shell sees a single value, the model a single
// tool name, the folder a single skill.
export function findVaultConflicts(candidate: Footprint, others: Footprint[], allAgents: string[]): VaultConflictEntry[] {
    const envKeys = new Set(Object.keys(candidate.env))
    const servers = new Set(candidate.config.mcpServers.map(server => server.name))
    const skills = new Set(candidate.config.skills.map(skill => skill.slug))
    if (envKeys.size === 0 && servers.size === 0 && skills.size === 0) return []
    const conflicts: VaultConflictEntry[] = []
    for (const other of others) {
        const shared = sharedAgents(candidate, other, allAgents)
        if (shared.length === 0) continue
        const clashes: Array<[VaultConflictEntry['kind'], string]> = [
            ...Object.keys(other.env).filter(key => envKeys.has(key)).map(name => ['env', name] as [VaultConflictEntry['kind'], string]),
            ...other.config.mcpServers.map(server => server.name).filter(name => servers.has(name)).map(name => ['server', name] as [VaultConflictEntry['kind'], string]),
            // Every account of one app ships the same skills, written once: only a different app
            // claiming the slug is a clash.
            ...other.config.skills.filter(skill => skills.has(skill.slug) && (other.config.slug === null || other.config.slug !== candidate.config.slug)).map(skill => ['skill', skill.slug] as [VaultConflictEntry['kind'], string]),
        ]
        for (const agentId of shared) for (const [kind, name] of clashes) conflicts.push({ agentId, itemId: other.id, kind, name })
    }
    return conflicts
}
