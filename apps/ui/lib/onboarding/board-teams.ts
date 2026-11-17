import type { TemplateAgent, TemplateCategory, TemplateConnector } from '@rerun/contracts'
import type { BoardAgent } from '@rerun/ui/iso-grid'

import { STARTER_PACKS } from './starter-packs'

// The teams the onboarding board draws while someone answers. They are the starter packs, the very
// coworkers the Chief of Staff offers once the onboarding is over, so what the board promises is
// what they are then given: the lead coworker of each template of their industry's pack.

export type BoardTeam = { id: string; agents: BoardAgent[]; connectors: TemplateConnector[] }

export type BoardTemplate = { slug: string; agents: TemplateAgent[]; connectors: TemplateConnector[] }

export type BoardTeamId = TemplateCategory | 'showcase'

export type BoardTeams = Record<BoardTeamId, BoardTeam>

// Before anyone has said a word: the first card of five lines of work far apart from one another, so
// the demo reads as "whatever you do" rather than as somebody else's industry.
const SHOWCASE_INDUSTRIES: TemplateCategory[] = ['agencies', 'ecommerce', 'real-estate', 'creators', 'recruiting']

const SHOWCASE_SLUGS = [...new Set(SHOWCASE_INDUSTRIES.map(industry => STARTER_PACKS[industry][0].template))]

export const BOARD_TEMPLATE_SLUGS = [...new Set([...SHOWCASE_SLUGS, ...Object.values(STARTER_PACKS).flatMap(pack => pack.map(card => card.template))])]

// Two templates often ship an agent under the same key, and a key is a tile on the board.
const boardAgent = (slug: string, agent: TemplateAgent): BoardAgent => ({ key: `${slug}-${agent.key}`, name: agent.name, connectorSlugs: agent.connectorSlugs })

function teamOf(id: string, agents: BoardAgent[], templates: BoardTemplate[]): BoardTeam {
    const used = new Set(agents.flatMap(agent => agent.connectorSlugs))
    const connectors = new Map<string, TemplateConnector>()
    for (const connector of templates.flatMap(template => template.connectors)) if (used.has(connector.slug) && !connectors.has(connector.slug)) connectors.set(connector.slug, connector)
    return { id, agents, connectors: [...connectors.values()] }
}

function leadTeam(id: string, slugs: string[], bySlug: Map<string, BoardTemplate>): BoardTeam {
    const templates = slugs.flatMap(slug => bySlug.get(slug) ?? [])
    const agents = templates.flatMap(template => (template.agents[0] ? [boardAgent(template.slug, template.agents[0])] : []))
    return teamOf(id, agents, templates)
}

export function starterTeams(templates: BoardTemplate[]): BoardTeams {
    const bySlug = new Map(templates.map(template => [template.slug, template]))
    const industries = Object.keys(STARTER_PACKS) as TemplateCategory[]
    const teams = Object.fromEntries(industries.map(industry => [industry, leadTeam(industry, STARTER_PACKS[industry].map(card => card.template), bySlug)]))
    return { ...teams, showcase: leadTeam('showcase', SHOWCASE_SLUGS, bySlug) } as BoardTeams
}

// Someone who arrived on a template sees all of it, every coworker it installs.
export function templateTeam(template: BoardTemplate): BoardTeam {
    return teamOf(`template-${template.slug}`, template.agents.map(agent => boardAgent(template.slug, agent)), [template])
}

// The team a board stands on: what they arrived for first, then their industry, then the showcase.
// A team the database could not fill (a template not published yet, a local stack with none) falls
// through to the next one rather than drawing an empty grid.
export function shownTeam(teams: BoardTeams, industry: TemplateCategory | null, focus: BoardTeam | null): BoardTeam | null {
    for (const team of [focus, industry ? teams[industry] : null, teams.showcase]) if (team?.agents.length) return team
    return null
}

export type BoardArrival = { kind: 'template'; slug: string } | { kind: 'share'; token: string }

// What a link carried through the sign-in, read off the `next` it is folded into.
export function arrivalOf(next: string | null | undefined): BoardArrival | null {
    if (!next?.startsWith('/')) return null
    const query = new URL(next, 'http://next.invalid').searchParams
    const slug = query.get('template')?.trim()
    if (slug) return { kind: 'template', slug }
    const token = query.get('share')?.trim()
    return token ? { kind: 'share', token } : null
}
