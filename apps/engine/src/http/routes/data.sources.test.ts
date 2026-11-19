import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-data-sources-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { TABLE_SOURCES_MAX_ROWS } = await import('@moldwright/contracts')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { recordPaidSources } = await import('../../db/repos/paid-sources.js')

const app = createServer()

function sources(path: string, rows: unknown[]) {
    return app.request(`${path}/sources`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) })
}

async function createAgent(id: string) {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: id }))
}

beforeAll(async () => {
    await createAgent('scout')
    await createAgent('closer')
    await createAgent('idle')
    await recordPaidSources('scout', {
        callId: 'scout-maps',
        at: '2026-11-01T10:00:00.000Z',
        capability: 'google.serp.maps',
        servedBy: 'serpapi.maps',
        output: { places: [{ title: 'Boulangerie Dupont', city: 'Paris', website: 'https://boulangerie-dupont.fr' }] },
    })
    await recordPaidSources('closer', {
        callId: 'closer-find',
        at: '2026-11-02T10:00:00.000Z',
        capability: 'people.email.find',
        servedBy: 'hunter',
        output: { email: 'jane@acme.com', first_name: 'Jane', last_name: 'Doe' },
        verdict: 'valid',
    })
})

const rows = [
    { name: 'Boulangerie Dupont', site: 'boulangerie-dupont.fr', city: 'Paris' },
    { contact: 'Jane Doe', email: 'jane@acme.com', score: 3, vip: true },
]

describe('POST /agents/:id/data/sources', () => {
    it('traces the rows to the paid calls of that agent only, one entry per row in order', async () => {
        const res = await sources('/agents/scout/data', rows)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.calls).toEqual({ 'scout-maps': { capability: 'google.serp.maps', servedBy: 'serpapi.maps', at: '2026-11-01T10:00:00.000Z' } })
        expect(body.rows).toHaveLength(2)
        expect(body.rows[0]).toEqual({
            sources: ['scout-maps'],
            cells: {
                name: { call: 'scout-maps', field: 'title', href: 'https://boulangerie-dupont.fr' },
                site: { call: 'scout-maps', field: 'website', href: 'https://boulangerie-dupont.fr' },
                city: { call: 'scout-maps', field: 'city', href: 'https://boulangerie-dupont.fr' },
            },
        })
        expect(body.rows[1]).toEqual({ sources: [], cells: {} })
    })

    it('answers empty rows for an agent that never bought anything', async () => {
        const res = await sources('/agents/idle/data', rows)
        expect(await res.json()).toEqual({
            calls: {},
            rows: [
                { sources: [], cells: {} },
                { sources: [], cells: {} },
            ],
        })
    })

    it('refuses an unknown agent', async () => {
        expect((await sources('/agents/ghost/data', rows)).status).toBe(404)
    })
})

describe('POST /shared/data/sources', () => {
    it('reads the paid calls of every agent of the box', async () => {
        const body = await (await sources('/shared/data', rows)).json()
        expect(Object.keys(body.calls).sort()).toEqual(['closer-find', 'scout-maps'])
        expect(body.rows[0].sources).toEqual(['scout-maps'])
        expect(body.rows[1]).toEqual({
            sources: ['closer-find'],
            cells: { contact: { call: 'closer-find', field: 'full_name' }, email: { call: 'closer-find', field: 'email', verdict: 'valid' } },
        })
    })
})

describe('request caps', () => {
    it(`takes up to ${TABLE_SOURCES_MAX_ROWS} rows and refuses more`, async () => {
        const wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`c${i}`, `value ${i} of a wide row`]))
        const full = await sources(
            '/shared/data',
            Array.from({ length: TABLE_SOURCES_MAX_ROWS }, (_, i) => ({ ...wide, email: `p${i}@acme.com` }))
        )
        expect(full.status).toBe(200)
        expect((await full.json()).rows).toHaveLength(TABLE_SOURCES_MAX_ROWS)

        expect(
            (
                await sources(
                    '/shared/data',
                    Array.from({ length: TABLE_SOURCES_MAX_ROWS + 1 }, () => ({ a: 1 }))
                )
            ).status
        ).toBe(400)
    })

    it('refuses a cell too long to be a value', async () => {
        expect((await sources('/agents/scout/data', [{ note: 'x'.repeat(2_001) }])).status).toBe(400)
    })
})
