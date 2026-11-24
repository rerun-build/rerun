import { RERUN_BRAND, RERUN_CONNECTION_ID, RERUN_MODEL, RERUN_MODELS, modelLabel, type Brand } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { brandConnection, brandConnections, modelName, offeredModels, planName } from './ai-sources'
import { connectionGroups } from './model-groups'
import { catalogFor, modelLogLabel } from './models'
import type { BoxConnection } from './types'

const ACME: Brand = { ...RERUN_BRAND, organizationId: 'org-1', name: 'Acme' }
const LEGACY_RERUN_MODEL = 'qwen/qwen3.7-max'
const t = englishTranslator('connections')

const connection = (fields: Pick<BoxConnection, 'id' | 'name' | 'provider' | 'models'>): BoxConnection => ({
    extraModels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    connected: true,
    credentialRejected: false,
    planLimits: null,
    cliModels: null,
    providerModels: null,
    discoveredModels: null,
    ...fields,
})

const managed = connection({ id: RERUN_CONNECTION_ID, name: 'Rerun', provider: 'rerun', models: [RERUN_MODELS.balanced, RERUN_MODELS.fast] })
const claude = connection({ id: 'cnx-claude', name: 'Rerun', provider: 'claude', models: ['claude-opus-5-5'] })
const list = { connections: [claude, managed], default: { connectionId: RERUN_CONNECTION_ID, model: RERUN_MODEL }, backups: { backups: [], rerunCreditLastResort: false } }

describe('the managed model', () => {
    it('is called Rerun by default, under both of its ids', () => {
        expect(modelLabel(RERUN_MODEL)).toBe('Rerun')
        expect(modelLabel(LEGACY_RERUN_MODEL)).toBe('Rerun')
        expect(modelName(RERUN_CONNECTION_ID, RERUN_MODEL)).toBe('Rerun')
        expect(modelName(RERUN_CONNECTION_ID, RERUN_MODELS.fast)).toBe('Rerun Fast')
        expect(modelLogLabel(RERUN_MODEL)).toBe('Rerun')
        expect(modelLogLabel(RERUN_MODELS.smart)).toBe('Rerun Smart')
        expect(catalogFor('rerun').label).toBe('Rerun')
        expect(catalogFor('rerun').models.map(model => model.label)).toEqual(['Rerun', 'Fast', 'Smart'])
    })

    it('goes by the name of the brand', () => {
        expect(modelLabel(RERUN_MODEL, 'Acme')).toBe('Acme')
        expect(modelLabel(LEGACY_RERUN_MODEL, 'Acme')).toBe('Acme')
        expect(modelName(RERUN_CONNECTION_ID, RERUN_MODEL, 'Acme')).toBe('Acme')
        expect(modelName(RERUN_CONNECTION_ID, RERUN_MODELS.fast, 'Acme')).toBe('Acme Fast')
        expect(modelLogLabel(RERUN_MODEL, 'Acme')).toBe('Acme')
        expect(modelLogLabel(RERUN_MODELS.smart, 'Acme')).toBe('Acme Smart')
        expect(catalogFor('rerun', 'Acme').label).toBe('Acme')
        expect(offeredModels(managed, 'Acme').map(model => model.label)).toEqual(['Acme'])
    })

    it('leaves every other model and provider alone', () => {
        expect(modelLabel('claude-opus-5-5', 'Acme')).toBe(modelLabel('claude-opus-5-5'))
        expect(modelName('cnx-claude', 'claude-opus-5-5', 'Acme')).toBe('Opus 5.5')
        expect(modelLogLabel('gpt-5.5', 'Acme')).toBe(modelLogLabel('gpt-5.5'))
        expect(modelLogLabel('someone/their-own-model', 'Acme')).toBe('someone/their-own-model')
        expect(catalogFor('anthropic', 'Acme')).toBe(catalogFor('anthropic'))
    })
})

describe('brandConnections', () => {
    it("renames Rerun's own connection and no other, even one a person called Rerun", () => {
        const branded = brandConnections(list, ACME)
        expect(branded.connections.map(({ id, name }) => [id, name])).toEqual([
            ['cnx-claude', 'Rerun'],
            [RERUN_CONNECTION_ID, 'Acme'],
        ])
        expect(branded.default).toEqual(list.default)
        expect(managed.name).toBe('Rerun')
    })

    it("keeps what the machine answered under Rerun's own brand", () => {
        expect(brandConnections(list, RERUN_BRAND)).toEqual(list)
        expect(brandConnection(managed, RERUN_BRAND)).toBe(managed)
    })

    it('names the group and the model of every picker', () => {
        const groups = connectionGroups(brandConnections(list, ACME).connections, t, ACME.name)
        expect(groups[0]).toMatchObject({ connectionId: RERUN_CONNECTION_ID, label: 'Acme', models: [{ id: RERUN_MODEL, label: 'Acme' }] })
        expect(connectionGroups(list.connections, t)[0]).toMatchObject({ label: 'Rerun', models: [{ label: 'Rerun' }] })
    })
})

describe('planName', () => {
    it('reads the connection a conversation moved to, whose name the machine stored', () => {
        expect(planName(managed)).toBe('Rerun')
        expect(planName(managed, ACME)).toBe('Acme')
        expect(planName(claude, ACME)).toBe('Claude')
    })
})
