import { type AgentArchivePlan, type TemplateAgent, agentArchivePlanSchema } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'
import { agentKeyFromName, archiveAgentNames, archivePath, archivesFromRow, projectAgent } from './archives'

describe('agentKeyFromName', () => {
    it('lowercases and joins words with single underscores', () => {
        expect(agentKeyFromName('  Sales -- Scout!  ', [])).toBe('sales_scout')
    })

    it('prefixes a key that would start with a digit, as the key schema requires a letter', () => {
        expect(agentKeyFromName('3D Artist', [])).toBe('a3d_artist')
    })

    it('falls back to "agent" when nothing usable is left', () => {
        expect(agentKeyFromName('!!!', [])).toBe('agent')
        expect(agentKeyFromName('', [])).toBe('agent')
    })

    it('numbers a key already taken from 2 upward', () => {
        expect(agentKeyFromName('Scout', ['scout'])).toBe('scout_2')
        expect(agentKeyFromName('Scout', ['scout', 'scout_2', 'scout_3'])).toBe('scout_4')
        expect(agentKeyFromName('', ['agent'])).toBe('agent_2')
    })

    it('always produces a key the template schema accepts', () => {
        for (const name of ['3D Artist', '!!!', 'Émile', '_x_', '42']) expect(agentKeyFromName(name, [])).toMatch(/^[a-z][a-z0-9_]*$/)
    })
})

describe('archivesFromRow', () => {
    it('fills the defaults of an archive written before a field existed', () => {
        const [archive] = archivesFromRow.parse([{ agentKey: 'scout', path: 'p', bytes: 1, capturedAt: 't' }])
        expect(archive).toMatchObject({ engineAgentId: '', engineCommit: null, envKeys: [], mcpAuth: [], redactions: [] })
    })

    it('reads a malformed column as no archive at all', () => {
        expect(archivesFromRow.parse('garbage')).toEqual([])
        expect(archivesFromRow.parse([{ agentKey: 'scout' }])).toEqual([])
    })
})

describe('archiveAgentNames', () => {
    it('follows the archive order and falls back to the key without an editorial entry', () => {
        const archives = archivesFromRow.parse([
            { agentKey: 'writer', path: 'a', bytes: 1, capturedAt: 't' },
            { agentKey: 'scout', path: 'b', bytes: 1, capturedAt: 't' },
        ])
        const agents = [{ key: 'scout', name: 'Scout' }] as TemplateAgent[]
        expect(archiveAgentNames(archives, agents)).toEqual(['writer', 'Scout'])
    })
})

describe('archivePath', () => {
    it('files the archive under the template and the agent', () => {
        expect(archivePath('crm-kit', 'scout')).toMatch(/^crm-kit\/scout\/[0-9a-f-]{36}\.tar\.gz$/)
    })
})

function plan(overrides: Partial<AgentArchivePlan> = {}): AgentArchivePlan {
    return {
        ...agentArchivePlanSchema.parse({ agentId: 'a1', name: 'scout', provider: 'rerun', model: 'm', totalBytes: 0 }),
        ...overrides,
    }
}

describe('projectAgent', () => {
    it('prefers the display name and keeps the manual role of a previous capture', () => {
        const previous = { key: 'scout', name: 'Old', role: 'Researcher', description: 'Old copy' } as TemplateAgent
        const agent = projectAgent(plan({ displayName: 'Scout' }), 'scout', new Set(), previous)
        expect(agent).toMatchObject({ key: 'scout', name: 'Scout', role: 'Researcher', description: 'Old copy' })
    })

    it('falls back to the folder name and an empty role on a first capture', () => {
        expect(projectAgent(plan({ description: 'Finds leads' }), 'scout', new Set())).toMatchObject({ name: 'scout', role: '', description: 'Finds leads' })
    })

    it('drops the skills a connector installed, one-shot schedules and disabled triggers', () => {
        const agent = projectAgent(
            plan({
                skills: [
                    { slug: 'stripe-usage', name: 'Stripe usage', description: '' },
                    { slug: 'outreach', name: 'Outreach', description: 'Writes emails' },
                ],
                schedules: [
                    { slug: 'daily', name: 'Daily', cron: '0 9 * * *' },
                    { slug: 'once', name: 'Once', cron: null },
                ],
                triggers: [
                    { slug: 'on', name: 'Inbound', description: 'd', methods: ['POST'], enabled: true },
                    { slug: 'off', name: 'Draft', description: '', methods: ['GET'], enabled: false },
                ],
                setup: { required: true, completedAt: null, prompt: '' },
            }),
            'scout',
            new Set(['stripe-usage']),
        )
        expect(agent.skills).toEqual([{ name: 'Outreach', description: 'Writes emails' }])
        expect(agent.schedules).toEqual([{ name: 'Daily', cron: '0 9 * * *' }])
        expect(agent.triggers).toEqual([{ name: 'Inbound', description: 'd', methods: ['POST'] }])
        expect(agent.setupRequired).toBe(true)
    })
})
