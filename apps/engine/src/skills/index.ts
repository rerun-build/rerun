import type { AgentConfig } from '@moldwright/contracts'
import { listSkillSummaries } from './loader.js'
import { disabledSkillSet } from './switch.js'

export async function buildSkillIndex(agentId: string, config: Pick<AgentConfig, 'disabledSkills'> = {}): Promise<string> {
    const off = disabledSkillSet(config)
    const skills = (await listSkillSummaries(agentId)).filter(s => !off.has(s.slug))
    if (skills.length === 0) return ''
    const lines = skills.map(s => `- ${s.name} (slug: ${s.slug}): ${s.description}`)
    return `You have these skills available. Read the full procedure with the skill_read tool before using one. A skill can bundle extra files (typically under references/); skill_read lists them and you read one with skill_read_file only when the procedure points you to it. When a message names a skill as /slug — for example /${skills[0].slug} — it points at the skill below with that slug, never at a file path or a shell command: read it with skill_read and follow it.\n\n${lines.join('\n')}`
}
