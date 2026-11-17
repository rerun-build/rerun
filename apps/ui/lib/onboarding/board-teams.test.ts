import type { TemplateAgent, TemplateConnector } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { arrivalOf, BOARD_TEMPLATE_SLUGS, shownTeam, starterTeams, templateTeam, type BoardTemplate } from './board-teams'
import { STARTER_PACKS } from './starter-packs'

const connector = (slug: string): TemplateConnector => ({ slug, name: slug, icon: null })

const agent = (key: string, connectorSlugs: string[]): TemplateAgent => ({ key, name: key, role: '', description: '', connectorSlugs, setupRequired: null, skills: [], schedules: [], triggers: [] }) as unknown as TemplateAgent

const template = (slug: string, agents: TemplateAgent[], connectors: string[] = []): BoardTemplate => ({ slug, agents, connectors: connectors.map(connector) })

const EVERY_TEMPLATE = BOARD_TEMPLATE_SLUGS.map(slug => template(slug, [agent('lead', ['gmail', 'slack']), agent('second', ['notion'])], ['gmail', 'slack', 'notion']))

describe('BOARD_TEMPLATE_SLUGS', () => {
    it('reads every template of every starter pack, once', () => {
        const packed = new Set(Object.values(STARTER_PACKS).flatMap(pack => pack.map(card => card.template)))
        for (const slug of packed) expect(BOARD_TEMPLATE_SLUGS).toContain(slug)
        expect(new Set(BOARD_TEMPLATE_SLUGS).size).toBe(BOARD_TEMPLATE_SLUGS.length)
    })
})

describe('starterTeams', () => {
    it('draws the lead coworker of each template of the pack, in the order of the cards', () => {
        const teams = starterTeams(EVERY_TEMPLATE)
        expect(teams.saas.agents.map(boardAgent => boardAgent.key)).toEqual(STARTER_PACKS.saas.map(card => `${card.template}-lead`))
    })

    it('keeps two templates that share an agent key apart on the board', () => {
        const keys = starterTeams(EVERY_TEMPLATE).ecommerce.agents.map(boardAgent => boardAgent.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('carries only the connectors its coworkers use, once each', () => {
        const team = starterTeams(EVERY_TEMPLATE).legal
        expect(team.connectors.map(item => item.slug).sort()).toEqual(['gmail', 'slack'])
    })

    it('leaves a template the database does not hold off the board rather than failing', () => {
        const teams = starterTeams([template('sales-development-rep', [agent('rep', ['hubspot'])], ['hubspot'])])
        expect(teams.saas.agents).toHaveLength(1)
        expect(teams.legal.agents).toHaveLength(0)
    })

    it('has a showcase of five different lines of work', () => {
        expect(starterTeams(EVERY_TEMPLATE).showcase.agents).toHaveLength(5)
    })
})

describe('templateTeam', () => {
    it('draws every coworker a template installs', () => {
        expect(templateTeam(template('agency-team', [agent('a', []), agent('b', []), agent('c', [])])).agents).toHaveLength(3)
    })
})

describe('shownTeam', () => {
    const teams = starterTeams(EVERY_TEMPLATE)

    it('prefers what they arrived for, then their industry, then the showcase', () => {
        const focus = templateTeam(template('picked', [agent('x', [])]))
        expect(shownTeam(teams, 'saas', focus)).toBe(focus)
        expect(shownTeam(teams, 'saas', null)).toBe(teams.saas)
        expect(shownTeam(teams, null, null)).toBe(teams.showcase)
    })

    it('falls through a team the database could not fill', () => {
        const thin = starterTeams([template('sales-development-rep', [agent('rep', [])])])
        expect(shownTeam(thin, 'legal', null)?.id).toBe('showcase')
        expect(shownTeam(starterTeams([]), 'legal', null)).toBeNull()
    })
})

describe('arrivalOf', () => {
    it('reads the template or the shared coworker a link carried through the sign-in', () => {
        expect(arrivalOf('/?template=crm-closer')).toEqual({ kind: 'template', slug: 'crm-closer' })
        expect(arrivalOf('/?template=crm-closer&purchase=1')).toEqual({ kind: 'template', slug: 'crm-closer' })
        expect(arrivalOf('/?share=abc123')).toEqual({ kind: 'share', token: 'abc123' })
    })

    it('reads nothing off a plain arrival, a prompt, or what is not a path of the app', () => {
        expect(arrivalOf('/')).toBeNull()
        expect(arrivalOf(null)).toBeNull()
        expect(arrivalOf('/?prompt=find%20leads')).toBeNull()
        expect(arrivalOf('https://evil.example/?template=x')).toBeNull()
    })
})
