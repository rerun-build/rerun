import { describe, expect, it } from 'vitest'

import type { BoxConnection } from '@/lib/engine/types'

import { readModelPin } from './model-pin'

function connection(id: string, name: string, provider: BoxConnection['provider'], models: string[], connected = true): BoxConnection {
    return { id, name, provider, models, extraModels: [], createdAt: '2026-01-01T00:00:00.000Z', connected, credentialRejected: false, planLimits: null, cliModels: null, providerModels: null }
}

const CODEX = connection('codex-clem', 'Codex Clem', 'codex', ['gpt-6-sol'])
const CLAUDE_OLD = connection('claude-clem', 'Claude Clem', 'claude', ['claude-opus-5-5', 'claude-sonnet-5-5'])
const CLAUDE_NEW = connection('claude-rerun', 'Rerun (person@example.com)', 'claude', ['claude-opus-5-5'])
const WORKSPACE = [CODEX, CLAUDE_OLD, CLAUDE_NEW]

describe('readModelPin', () => {
    it('leaves the pin alone when the call names none of its fields', () => {
        expect(readModelPin({ soul: 'x' }, WORKSPACE)).toBeUndefined()
    })

    it('pins the named connection and aligns the provider on it', () => {
        expect(readModelPin({ connectionId: 'claude-rerun', model: 'claude-opus-5-5' }, WORKSPACE)).toEqual({ connectionId: 'claude-rerun', provider: 'claude', model: 'claude-opus-5-5' })
    })

    it('refuses to pick one of several connections of a provider in silence', () => {
        expect(() => readModelPin({ provider: 'claude', model: 'claude-opus-5-5' }, WORKSPACE)).toThrow(/several claude connections.*claude-clem.*claude-rerun/)
    })

    it('resolves a bare provider onto its only connection, whatever the coworker was pinned to', () => {
        expect(readModelPin({ provider: 'codex', model: 'gpt-6-sol' }, WORKSPACE, 'claude-clem')).toEqual({ connectionId: 'codex-clem', provider: 'codex', model: 'gpt-6-sol' })
    })

    it('refuses a model the connection does not serve, and says what it serves', () => {
        expect(() => readModelPin({ connectionId: 'codex-clem', model: 'claude-opus-5-5' }, WORKSPACE)).toThrow(/does not serve "claude-opus-5-5".*gpt-6-sol/)
    })

    it('refuses a provider that contradicts the connection', () => {
        expect(() => readModelPin({ connectionId: 'codex-clem', provider: 'claude', model: 'gpt-6-sol' }, WORKSPACE)).toThrow(/is a codex connection, not claude/)
    })

    it('refuses an unknown connection and a connection that is not signed in', () => {
        expect(() => readModelPin({ connectionId: 'nope', model: 'x' }, WORKSPACE)).toThrow(/Unknown AI connection "nope"/)
        expect(() => readModelPin({ connectionId: 'off', model: 'gpt-6-sol' }, [connection('off', 'Codex Off', 'codex', ['gpt-6-sol'], false)])).toThrow(/not signed in/)
    })

    it('drops the whole pin on model null', () => {
        expect(readModelPin({ model: null }, WORKSPACE)).toEqual({ connectionId: null, provider: null, model: null })
        expect(readModelPin({ connectionId: 'claude-rerun', model: null }, WORKSPACE)).toEqual({ connectionId: null, provider: null, model: null })
    })

    it('falls back to the first model of the connection when none is named', () => {
        expect(readModelPin({ connectionId: 'claude-clem' }, WORKSPACE)).toEqual({ connectionId: 'claude-clem', provider: 'claude', model: 'claude-opus-5-5' })
    })

    it('keeps the connection in use for a model alone when it serves it', () => {
        expect(readModelPin({ model: 'claude-opus-5-5' }, WORKSPACE, 'claude-rerun')).toMatchObject({ connectionId: 'claude-rerun' })
    })

    it('resolves a model alone onto the single connection that serves it, and refuses when several do', () => {
        expect(readModelPin({ model: 'claude-sonnet-5-5' }, WORKSPACE, 'codex-clem')).toMatchObject({ connectionId: 'claude-clem' })
        expect(() => readModelPin({ model: 'claude-opus-5-5' }, WORKSPACE, 'codex-clem')).toThrow(/Several AI connections serve/)
        expect(() => readModelPin({ model: 'unknown-model' }, WORKSPACE)).toThrow(/No AI connection of this workspace serves/)
    })

    it('writes a renamed model under the spelling the connection still lists', () => {
        const legacy = connection('rerun', 'Rerun', 'rerun', ['qwen/qwen3.7-max'])
        expect(readModelPin({ connectionId: 'rerun', model: 'rerun-max' }, [legacy])).toMatchObject({ model: 'qwen/qwen3.7-max' })
    })
})
