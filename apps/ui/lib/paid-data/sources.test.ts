import { paidCallReceipt, paidDataSourceOf, paidDataSourcesByTurn } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'

import { toApiMessages, type HistoryMessage } from '@/lib/chat/engine-history'

type Part = { type: string; text?: string; toolName?: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown }

const paid = (capability: string, params: Record<string, unknown>, output: unknown, type = 'tool-paid_data'): Part => ({ type, toolCallId: `${capability}-call`, state: 'output-available', input: { capability, params }, output })

const found = (servedBy: string, output: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ status: 'found', billedMicros: 1, message: 'Found.', servedBy, result: { output, ...extra } })

const user = (id: string) => ({ id, role: 'user', parts: [{ type: 'text', text: 'Find leads' }] })
const assistant = (id: string, parts: Part[]) => ({ id, role: 'assistant', parts })

describe('paidDataSourceOf', () => {
    it('names the platform a scraper read from, never the scraper', () => {
        expect(paidDataSourceOf('google.serp.maps', 'crawl4ai.google.serp.maps')).toMatchObject({ name: 'Google Maps', kind: 'origin' })
        expect(paidDataSourceOf('tiktok.user.profile', 'tikhub.x.tiktok-app-v3-fetch-user')).toMatchObject({ name: 'TikTok', kind: 'origin' })
        expect(paidDataSourceOf('linkedin.user.posts', 'fetchinio.linkedin.user.posts')).toMatchObject({ name: 'LinkedIn', kind: 'origin' })
        expect(paidDataSourceOf('people.search', 'enrichlayer.people.search')).toMatchObject({ name: 'LinkedIn', domain: 'linkedin.com', kind: 'origin' })
    })

    it('names a vendor that owns its data', () => {
        expect(paidDataSourceOf('people.email.find', 'hunter.people.email.find')).toMatchObject({ name: 'Hunter', domain: 'hunter.io', kind: 'vendor' })
        expect(paidDataSourceOf('companies.search', 'hunter.x.discover-companies')).toMatchObject({ name: 'Hunter', kind: 'vendor' })
    })

    it('falls back to a generic provider for a reseller or an unknown vendor', () => {
        expect(paidDataSourceOf('people.search', 'crawl4ai.people.search')).toMatchObject({ name: 'Data provider', kind: 'generic', domain: null })
        expect(paidDataSourceOf('people.search', 'somenewvendor.people.search')).toMatchObject({ kind: 'generic' })
        expect(paidDataSourceOf('people.search', null)).toMatchObject({ kind: 'generic' })
    })
})

describe('paidCallReceipt', () => {
    it('counts a call billed per call once, whatever list it returned', () => {
        const output = found('crawl4ai.google.serp.maps', { places: [{}, {}, {}] })
        expect(paidCallReceipt('google.serp.maps', { limit: 20 }, output)).toMatchObject({ found: 1, asked: 1 })
    })

    it('counts the rows a search returned against the rows it asked for', () => {
        const output = found('quickenrich.people.search', { people: [{}, {}, {}] })
        expect(paidCallReceipt('people.search', { limit: 5 }, output)).toEqual({ status: 'found', servedBy: 'quickenrich.people.search', found: 3, asked: 5, verdict: null })
    })

    it('reads the email check of a find and of a verify', () => {
        expect(paidCallReceipt('people.email.find', {}, found('hunter', { email: 'a@b.co' }, { verification: { verdict: 'Valid' } }))?.verdict).toBe('valid')
        expect(paidCallReceipt('people.email.verify', { email: 'a@b.co' }, found('orbisearch', { status: 'accept_all' }))?.verdict).toBe('accept_all')
    })

    it('reads an output reloaded behind its envelope, and a trimmed one by its receipt', () => {
        const envelope = { type: 'json', value: found('hunter', { email: 'a@b.co' }) }
        expect(paidCallReceipt('people.email.find', {}, envelope)).toMatchObject({ status: 'found', found: 1, asked: 1 })
        const receipt = { status: 'found', servedBy: 'hunter', found: 1, asked: 1, verdict: 'valid' } as const
        expect(paidCallReceipt('people.email.find', {}, { status: 'found', truncated: true, preview: '…', receipt })).toEqual(receipt)
    })
})

describe('paidDataSourcesByTurn', () => {
    it('adds up the calls of a turn spread over several reloaded messages, under its last assistant message', () => {
        const messages = [
            user('u1'),
            assistant('a1', [paid('google.serp.maps', { q: 'restaurant', limit: 20 }, found('crawl4ai.google.serp.maps', { places: Array.from({ length: 20 }, () => ({})) }))]),
            assistant('a2', [
                paid('people.email.find', {}, found('hunter.people.email.find', { email: 'a@b.co' }, { verification: { verdict: 'valid' } })),
                paid('people.email.find', {}, { status: 'nothing_found', billedMicros: 0, message: 'Nothing found.', result: { output: { email: null } } }),
                paid('people.email.find', {}, { status: 'not_run', billedMicros: 0, message: 'Not run.' }),
                { type: 'text', text: 'Done.' },
            ]),
        ]
        const turn = paidDataSourcesByTurn(messages).get('a2')
        expect(turn?.sources.map(source => source.name)).toEqual(['Google Maps', 'Hunter'])
        expect(turn?.lines).toEqual([
            expect.objectContaining({ capability: 'google.serp.maps', found: 1, asked: 1 }),
            expect.objectContaining({ capability: 'people.email.find', found: 1, asked: 2 }),
        ])
        expect(turn?.emails).toEqual({ checked: 1, valid: 1 })
        expect(paidDataSourcesByTurn(messages).has('a1')).toBe(false)
    })

    it('keeps each turn apart and reads a call made through the bridge', () => {
        const bridged = { ...paid('people.email.find', {}, found('hunter', { email: 'a@b.co' })), type: 'dynamic-tool', toolName: 'mcp__rerun__paid_data' }
        const byTurn = paidDataSourcesByTurn([user('u1'), assistant('a1', [bridged]), user('u2'), assistant('a2', [{ type: 'text', text: 'Hi' }])])
        expect([...byTurn.keys()]).toEqual(['a1'])
    })
})

describe('the history trim', () => {
    it('keeps where a paid call bought its data when it trims its output', () => {
        const places = Array.from({ length: 20 }, (_, i) => ({ name: `Place ${i}`, about: 'p'.repeat(1_000) }))
        const output = { status: 'found', billedMicros: 15_000, message: 'Found.', servedBy: 'crawl4ai.google.serp.maps', result: { output: { places } } }
        const call: HistoryMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'tool-paid_data', toolCallId: 'c1', toolName: 'paid_data', state: 'output-available', input: { capability: 'google.serp.maps', params: { q: 'restaurant', limit: 20 } }, output }] }
        const [message] = toApiMessages([call])
        expect(message.parts[0]).toMatchObject({ output: { truncated: true, receipt: { status: 'found', servedBy: 'crawl4ai.google.serp.maps', found: 1, asked: 1, verdict: null } } })
    })
})
