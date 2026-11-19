import { cliServesModel } from '@moldwright/contracts'
import { describe, expect, it, vi } from 'vitest'
import { REFUSAL_TTL_MS, forgetCliModels, readCliModels, recordCliModels, recordRefusedModel } from './cli-models.js'

describe('cli models', () => {
    it('keeps no reading of an empty answer, so nothing gets locked by a probe that saw nothing', () => {
        recordCliModels('c1', [], '0.166.0', false)
        expect(readCliModels('c1')).toBeNull()
    })

    it('holds one reading per connection until it is forgotten', () => {
        recordCliModels('c1', ['opus', 'claude-opus-5-5', 'claude-opus-5-5'], '2.1.317', false)
        expect(readCliModels('c1')).toMatchObject({ models: ['opus', 'claude-opus-5-5'], version: '2.1.317', outdated: false })
        forgetCliModels('c1')
        expect(readCliModels('c1')).toBeNull()
    })

    it('drops a model a run was refused on from every later reading, until the credential changes', () => {
        recordCliModels('c2', ['gpt-6-sol', 'gpt-6-luna'], '0.166.0', false)
        recordRefusedModel('c2', 'gpt-6-sol')
        expect(readCliModels('c2')?.models).toEqual(['gpt-6-luna'])
        recordCliModels('c2', ['gpt-6-sol', 'gpt-6-luna'], '0.166.0', false)
        expect(readCliModels('c2')?.models).toEqual(['gpt-6-luna'])
        forgetCliModels('c2')
        recordCliModels('c2', ['gpt-6-sol', 'gpt-6-luna'], '0.166.0', false)
        expect(readCliModels('c2')?.models).toEqual(['gpt-6-sol', 'gpt-6-luna'])
    })
})

describe('a refused model', () => {
    it('comes back once the refusal expires, for a plan upgraded on the same account', () => {
        vi.useFakeTimers()
        try {
            recordCliModels('c3', ['gpt-6-sol', 'gpt-6-luna'], '0.166.0', false)
            recordRefusedModel('c3', 'gpt-6-sol')
            vi.advanceTimersByTime(REFUSAL_TTL_MS - 1)
            expect(readCliModels('c3')?.models).toEqual(['gpt-6-luna'])
            vi.advanceTimersByTime(1)
            expect(readCliModels('c3')?.models).toEqual(['gpt-6-sol', 'gpt-6-luna'])
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('cliServesModel', () => {
    const reading = { models: ['claude-opus-4-8', 'claude-sonnet-5-5'], version: '2.1.317', outdated: false, capturedAt: '2026-11-03T00:00:00.000Z' }

    it('serves everything without a reading', () => {
        expect(cliServesModel('codex', null, 'gpt-6.1-terra')).toBe(true)
    })

    it('serves a listed model and its 1M-context variant, nothing else', () => {
        expect(cliServesModel('codex', reading, 'claude-sonnet-5-5')).toBe(true)
        expect(cliServesModel('codex', reading, 'claude-opus-4-8[1m]')).toBe(true)
        expect(cliServesModel('codex', reading, 'claude-haiku-5-5')).toBe(false)
    })

    it('refuses nothing on a Claude reading, which names the picker rather than the account', () => {
        expect(cliServesModel('claude', reading, 'claude-haiku-5-5')).toBe(true)
    })
})
