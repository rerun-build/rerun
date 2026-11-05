import { describe, expect, it } from 'vitest'
import type { CliModels } from '@rerun/contracts'
import { cliUnavailableReason } from './ai-sources'
import { toGroup } from './model-groups'
import type { BoxConnection } from './types'

const reading = (models: string[], outdated: boolean): CliModels => ({ models, version: outdated ? '0.156.1' : '0.166.0', outdated, capturedAt: '2026-11-03T08:00:00.000Z' })

function codex(cliModels: CliModels | null, extraModels: string[] = []): BoxConnection {
    return {
        id: 'cnx-codex',
        name: 'ChatGPT',
        provider: 'codex',
        models: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'],
        extraModels,
        createdAt: '2026-01-01T00:00:00.000Z',
        connected: true,
        credentialRejected: false,
        planLimits: null,
        cliModels,
        providerModels: null,
    }
}

describe('cliUnavailableReason', () => {
    it('says nothing until the CLI has been asked', () => {
        expect(cliUnavailableReason(codex(null), 'gpt-6.1-sol')).toBeUndefined()
    })

    it('blames the engine when the binary is off its pin, the plan when it is not', () => {
        expect(cliUnavailableReason(codex(reading(['gpt-6-sol'], true)), 'gpt-6.1-sol')).toBe('Codex CLI outdated on this box')
        expect(cliUnavailableReason(codex(reading(['gpt-6-luna'], false)), 'gpt-6-sol')).toBe('Not in your ChatGPT plan')
    })

    it('never blames a Claude reading, which lists the picker rather than the account', () => {
        expect(cliUnavailableReason({ provider: 'claude', cliModels: reading(['claude-opus-5-5'], false) }, 'claude-haiku-5-5')).toBeUndefined()
    })
})

describe('toGroup', () => {
    it('marks what the CLI does not serve and defaults to the first model it does', () => {
        const group = toGroup(codex(reading(['gpt-6-sol', 'gpt-6-luna'], true)), true)
        expect(group.models.find(m => m.id === 'gpt-6.1-sol')?.unavailable).toBe('Codex CLI outdated on this box')
        expect(group.models.find(m => m.id === 'gpt-6-sol')?.unavailable).toBeUndefined()
        expect(group.defaultModel).toBe('gpt-6-sol')
    })

    it('marks an extra model the CLI does not list, like any other', () => {
        const extra = (connection: BoxConnection) => toGroup(connection, true).models.find(m => m.id === 'gpt-6.2-nova')
        expect(extra(codex(reading(['gpt-6-sol'], false), ['gpt-6.2-nova']))?.unavailable).toBe('Not in your ChatGPT plan')
        expect(extra(codex(null, ['gpt-6.2-nova']))?.unavailable).toBeUndefined()
    })

    it('keeps the first model as default without a reading', () => {
        expect(toGroup(codex(null), true).defaultModel).toBe('gpt-6.1-sol')
    })
})
