import type { AgentConfig } from '@rerun/contracts'
import { readAgentConfig } from '../agents/loader.js'
import { withAgentLock } from '../agents/lock.js'
import { writeAgentConfig } from '../agents/config-write.js'

export function disabledSkillSet(config: Pick<AgentConfig, 'disabledSkills'>): Set<string> {
    return new Set(config.disabledSkills ?? [])
}

async function store(agentId: string, config: AgentConfig, off: Set<string>): Promise<void> {
    const { disabledSkills: _previous, ...rest } = config
    const next: AgentConfig = off.size === 0 ? rest : { ...rest, disabledSkills: [...off].sort() }
    await writeAgentConfig(agentId, next)
}

export function setSkillEnabled(agentId: string, slug: string, enabled: boolean): Promise<void> {
    return withAgentLock(agentId, async () => {
        const config = await readAgentConfig(agentId)
        const off = disabledSkillSet(config)
        if (enabled) off.delete(slug)
        else off.add(slug)
        await store(agentId, config, off)
    })
}

export function forgetSkill(agentId: string, slug: string): Promise<void> {
    return withAgentLock(agentId, async () => {
        const config = await readAgentConfig(agentId)
        const off = disabledSkillSet(config)
        if (!off.delete(slug)) return
        await store(agentId, config, off)
    })
}
