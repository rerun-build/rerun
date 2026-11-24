import { RERUN_BRAND, RERUN_CONNECTION_ID, RERUN_MODELS, type Brand } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoxConnection, EngineConnection } from '@/lib/engine/types'
import { listAiConnections, updateAiConnection } from './ai-connection.service'

type EngineClient = typeof import('@/lib/engine/client')

const engine = vi.hoisted(() => ({ listConnections: vi.fn<EngineClient['listConnections']>(), patchConnection: vi.fn<EngineClient['patchConnection']>() }))
const state = vi.hoisted(() => ({ brand: null as Brand | null }))

vi.mock('@/lib/brand/server', () => ({ getBrand: async () => state.brand }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: async (): Promise<Partial<EngineConnection>> => ({}), findWorkspaceEngine: vi.fn(), ensureWorkspaceEngine: vi.fn() }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<EngineClient>()), ...engine }))

const managed: BoxConnection = {
    id: RERUN_CONNECTION_ID,
    name: 'Rerun',
    provider: 'rerun',
    models: [RERUN_MODELS.balanced],
    extraModels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    connected: true,
    credentialRejected: false,
    planLimits: null,
    cliModels: null,
    providerModels: null,
    discoveredModels: null,
}

beforeEach(() => {
    state.brand = { ...RERUN_BRAND, organizationId: 'org-1', name: 'Acme' }
    engine.listConnections.mockReset().mockResolvedValue({ connections: [managed], default: null, backups: { backups: [], rerunCreditLastResort: false } })
    engine.patchConnection.mockReset().mockResolvedValue(managed)
})

const listedName = async () => (await listAiConnections(7)).connections[0].name

describe("Rerun's own connection", () => {
    it('is listed under the name of the brand', async () => {
        expect(await listedName()).toBe('Acme')
        state.brand = RERUN_BRAND
        expect(await listedName()).toBe('Rerun')
    })

    it('keeps that name once edited, and never sends it to the machine', async () => {
        const updated = await updateAiConnection(7, RERUN_CONNECTION_ID, { models: [RERUN_MODELS.balanced] })
        expect(updated.name).toBe('Acme')
        expect(engine.patchConnection).toHaveBeenCalledWith(expect.anything(), RERUN_CONNECTION_ID, { models: [RERUN_MODELS.balanced] })
    })

    it('moves off a retired model id without its name following', async () => {
        engine.listConnections.mockResolvedValueOnce({ connections: [{ ...managed, models: ['qwen/qwen3.7-max'] }], default: null, backups: { backups: [], rerunCreditLastResort: false } })
        expect(await listedName()).toBe('Acme')
        expect(engine.patchConnection).toHaveBeenCalledWith(expect.anything(), RERUN_CONNECTION_ID, { models: [RERUN_MODELS.balanced], extraModels: [] })
    })
})
