import { describe, expect, it } from 'vitest'

import { PROVIDER_STATUS_PAGES, parseStatusSummary, statusPagesFor } from './provider-status'

const openai = PROVIDER_STATUS_PAGES.find(page => page.id === 'openai')!
const anthropic = PROVIDER_STATUS_PAGES.find(page => page.id === 'anthropic')!

const CLAUDE_API = { id: 'k8w3r06qmzrp', name: 'Claude API (api.anthropic.com)' }
const CLAUDE_CONSOLE = { id: '0qbwn08sd68x', name: 'Claude Console (platform.claude.com)' }
const CHAT_COMPLETIONS = { id: '01JMXBRMFE6N2NNT7DG6XZQ6PW', name: 'Chat Completions' }
const COMPLIANCE_API = { id: '01JNKS9D9S72PMP1938PVFFQN4', name: 'Compliance API' }

type Incident = { id: string; name: string; components?: { id: string }[] }

const summary = (components: ({ id: string; name: string } & { status: string })[], incidents?: Incident[]) => ({
    page: { id: 'page', name: 'Page' },
    status: { indicator: 'minor', description: 'Partial System Degradation' },
    components,
    ...(incidents && { incidents }),
})

describe('parseStatusSummary', () => {
    it('ignores an incident on a component Moldwright does not call', () => {
        const json = summary(
            [
                { ...CLAUDE_API, status: 'operational' },
                { ...CLAUDE_CONSOLE, status: 'major_outage' },
            ],
            [{ id: '978mjkgw6mh7', name: 'Elevated errors on platform.claude.com', components: [{ id: CLAUDE_CONSOLE.id }] }]
        )
        expect(parseStatusSummary(anthropic, json)).toBeNull()

        expect(parseStatusSummary(openai, summary([{ ...COMPLIANCE_API, status: 'partial_outage' }], [{ id: '01M4GV1M2A3K38T73JCVCD9G0R', name: 'Delayed Costs data' }]))).toBeNull()
    })

    it('ignores a mere slowdown on a watched component', () => {
        expect(parseStatusSummary(anthropic, summary([{ ...CLAUDE_API, status: 'degraded_performance' }], []))).toBeNull()
    })

    it.each([
        ['partial_outage', 'degraded'],
        ['major_outage', 'outage'],
    ])('reads a %s on a watched component as %s', (status, severity) => {
        expect(parseStatusSummary(anthropic, summary([{ ...CLAUDE_API, status }], []))?.severity).toBe(severity)
    })

    it('links the incident that touches the watched component, not the first one listed', () => {
        const json = summary(
            [
                { ...CLAUDE_API, status: 'partial_outage' },
                { ...CLAUDE_CONSOLE, status: 'major_outage' },
            ],
            [
                { id: 'console', name: 'Elevated errors on platform.claude.com', components: [{ id: CLAUDE_CONSOLE.id }] },
                { id: 'k0h22tsvnydg', name: 'Elevated errors on Claude API', components: [{ id: CLAUDE_API.id }] },
            ]
        )

        expect(parseStatusSummary(anthropic, json)).toEqual({
            id: 'anthropic:k0h22tsvnydg',
            provider: 'anthropic',
            label: 'Anthropic',
            severity: 'degraded',
            title: 'Elevated errors on Claude API',
            url: 'https://status.claude.com/incidents/k0h22tsvnydg',
        })
    })

    it('falls back on an incident naming no component, as OpenAI lists none', () => {
        const json = summary([{ ...CHAT_COMPLETIONS, status: 'major_outage' }], [{ id: '01M45E0JFFJZ6EQ3BWYPW74R2Z', name: 'Elevated Chat Completions errors' }])

        expect(parseStatusSummary(openai, json)).toMatchObject({
            id: 'openai:01M45E0JFFJZ6EQ3BWYPW74R2Z',
            severity: 'outage',
            url: 'https://status.openai.com/incidents/01M45E0JFFJZ6EQ3BWYPW74R2Z',
        })
    })

    it('names the broken components and links the page when no incident is listed', () => {
        expect(parseStatusSummary(openai, summary([{ ...CHAT_COMPLETIONS, status: 'partial_outage' }]))).toEqual({
            id: `openai:${CHAT_COMPLETIONS.id}`,
            provider: 'openai',
            label: 'OpenAI',
            severity: 'degraded',
            title: 'Chat Completions',
            url: 'https://status.openai.com',
        })
    })

    it.each([null, 'oops', {}, { components: [{ id: 3 }] }])('reports nothing on an unexpected payload', json => {
        expect(parseStatusSummary(openai, json)).toBeNull()
    })
})

describe('statusPagesFor', () => {
    it.each([
        [['rerun'], []],
        [['openrouter', 'google'], []],
        [['claude', 'rerun'], ['anthropic']],
        [['codex', 'openai'], ['openai']],
        [['anthropic', 'codex'], ['openai', 'anthropic']],
    ] as const)('maps the connections %j to the status pages %j', (providers, pages) => {
        expect(statusPagesFor([...providers])).toEqual(pages)
    })
})
