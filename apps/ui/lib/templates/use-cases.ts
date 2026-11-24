import type { TemplateAgent, TemplateConnector } from '@rerun/contracts'
import { capitalize } from '@/lib/data/friendly-columns'
import type { LibraryTemplate } from './library'

// One task a coworker of the catalogue knows how to do: a skill, seen by someone who has not hired
// that coworker yet.
export type UseCase = {
    // A skill carries no identifier of its own, so this one only holds for the catalogue in memory.
    id: string
    name: string
    summary: string
    agent: TemplateAgent
    template: LibraryTemplate
    connectors: TemplateConnector[]
}

export type CoworkerUseCases = { agent: TemplateAgent; useCases: UseCase[] }

// A few older templates kept the folder name of the skill instead of a title.
function useCaseName(skillName: string): string {
    return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(skillName) ? capitalize(skillName.replaceAll('-', ' ')) : skillName
}

// A skill's description tells the coworker when to pick it up ("Use when asked to chase an invoice,
// or to…"). Someone browsing wants what it does, so the first sentence alone is kept, without that.
export function useCaseSummary(description: string): string {
    const [first = ''] = description.trim().split(/(?<=[.!?])\s/)
    const task = first.replace(/[,;]? and (for [^,;.]+ )?on the (daily|weekly|monthly|quarterly|yearly)\b[^.]*/i, '')
    const asked = task.replace(/^use when(ever)? asked (to |for |about )?/i, '')
    if (asked === task) return capitalize(task.replace(/^use (?=when|(?:after|for)\b)/i, ''))
    return capitalize(/^use when(ever)? asked to /i.test(task) ? asked.replace(/(,? or) to /g, '$1 ') : asked)
}

export function coworkerUseCases(template: LibraryTemplate): CoworkerUseCases[] {
    return template.agents.map(agent => {
        const connectors = template.connectors.filter(connector => agent.connectorSlugs.includes(connector.slug))
        return {
            agent,
            useCases: agent.skills.map((skill, index) => ({
                id: `${template.slug}:${agent.key}:${index}`,
                name: useCaseName(skill.name),
                summary: useCaseSummary(skill.description),
                agent,
                template,
                connectors,
            })),
        }
    })
}

function matchesUseCase(useCase: UseCase, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [useCase.name, useCase.summary, useCase.agent.name, ...useCase.connectors.map(connector => connector.name)].some(field => field.toLowerCase().includes(q))
}

// One use case of each coworker, then the second of each: six in a row from the same one would hide
// how wide the list is.
function interleave(groups: CoworkerUseCases[]): UseCase[] {
    const deepest = Math.max(0, ...groups.map(group => group.useCases.length))
    return Array.from({ length: deepest }, (_, index) => groups.flatMap(group => group.useCases[index] ?? [])).flat()
}

export function findUseCases(coworkers: CoworkerUseCases[], { query, connectorSlugs }: { query: string; connectorSlugs: string[] }): UseCase[] {
    const matches = (useCase: UseCase) => matchesUseCase(useCase, query) && (connectorSlugs.length === 0 || useCase.connectors.some(connector => connectorSlugs.includes(connector.slug)))
    return interleave(coworkers.map(coworker => ({ ...coworker, useCases: coworker.useCases.filter(matches) })))
}
