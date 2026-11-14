import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-trigger-index-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { buildTriggerIndex } = await import('./index.js')
const { markFired, writeTrigger } = await import('./loader.js')

describe('buildTriggerIndex', () => {
    it('is empty when no trigger is enabled', async () => {
        expect(await buildTriggerIndex('notriggers')).toBe('')
        await writeTrigger('allOff', { name: 'Off', body: 'x', enabled: false })
        expect(await buildTriggerIndex('allOff')).toBe('')
    })

    it('lists the enabled triggers by slug, with neither their call count nor their token', async () => {
        const fresh = await writeTrigger('hooks', { name: 'Stripe refund', body: 'Record it.', methods: ['POST', 'GET'] })
        const called = await writeTrigger('hooks', { name: 'GitHub push', body: 'Review it.' })
        await writeTrigger('hooks', { name: 'Paused', body: 'x', enabled: false })
        await markFired('hooks', 'github-push', '2026-09-01T10:00:00.000Z')
        await markFired('hooks', 'github-push', '2026-09-02T10:00:00.000Z')

        const index = await buildTriggerIndex('hooks')
        expect(index).toContain('trigger_get')
        expect(index.split('\n').filter(l => l.startsWith('- '))).toEqual(['- GitHub push (slug: github-push): POST', '- Stripe refund (slug: stripe-refund): POST/GET'])
        expect(index).not.toContain('call(s)')
        expect(index).not.toContain('Paused')
        expect(index).not.toContain(fresh.token)
        expect(index).not.toContain(called.token)
    })
})
