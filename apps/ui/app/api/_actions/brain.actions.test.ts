import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listBrainProposalsAction, loadBrainAction } from './brain.actions'
import { listWorkspaceTablesAction } from './workspace-db.actions'
import { listWorkspaceFilesAction } from './workspace-file.actions'

vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: vi.fn() }))
vi.mock('@/app/api/_auth/workspace-target', () => ({ requireWorkspaceConnection: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ NoEngineError: class NoEngineError extends Error {}, getWorkspaceConnection: vi.fn() }))
vi.mock('@/app/api/_services/file.service', () => ({ saveTextFile: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({
    EngineRequestError: class EngineRequestError extends Error {
        constructor(
            message: string,
            readonly status: number
        ) {
            super(message)
        }
    },
    SPACE_DATA_BASE: '/shared/db',
    countBrainProposals: vi.fn(),
    listBrainPages: vi.fn(),
    listBrainProposals: vi.fn(),
    listDbTables: vi.fn(),
    listFiles: vi.fn(),
}))

const conn = { baseUrl: 'https://engine.test', apiKey: 'box-key' }

describe('a workspace without a machine yet', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(requireWorkspaceConnection).mockRejectedValue(new NoEngineError())
    })

    it('reads the Brain as not set up rather than failing', async () => {
        await expect(loadBrainAction()).resolves.toEqual({ available: false, reason: 'no_machine' })
        await expect(listBrainProposalsAction()).resolves.toEqual([])
    })

    it('lists no shared table and no shared file', async () => {
        await expect(listWorkspaceTablesAction()).resolves.toEqual({ success: true, tables: [] })
        await expect(listWorkspaceFilesAction('docs')).resolves.toEqual({ entries: [], path: 'docs' })
    })
})

describe('a workspace with a machine', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(requireWorkspaceConnection).mockResolvedValue(conn)
    })

    it('reads a box that predates the Brain as outdated', async () => {
        vi.mocked(engine.listBrainPages).mockRejectedValue(new engine.EngineRequestError('failed: 404', 404))
        vi.mocked(engine.countBrainProposals).mockResolvedValue(0)
        await expect(loadBrainAction()).resolves.toEqual({ available: false, reason: 'outdated' })
    })

    it('lists the shared tables', async () => {
        vi.mocked(engine.listDbTables).mockResolvedValue([{ name: 'catalog', columns: [] }])
        await expect(listWorkspaceTablesAction()).resolves.toEqual({ success: true, tables: [{ name: 'catalog', columns: [] }] })
    })

    it('names an engine that predates the shared database rather than calling it unreachable', async () => {
        vi.mocked(engine.listDbTables).mockRejectedValue(new engine.EngineRequestError('rerun-engine GET /shared/db/tables failed: 404 Not Found', 404))
        await expect(listWorkspaceTablesAction()).resolves.toEqual({
            success: false,
            error: 'This workspace runs on a machine that needs an engine update before it can host a shared database.',
            code: 'sharedDbNeedsEngineUpdate',
        })
    })

    it('passes on why the workspace cannot be reached rather than blaming its machine', async () => {
        vi.mocked(requireWorkspaceConnection).mockRejectedValue(new Error('You are not a member of this workspace'))
        await expect(listWorkspaceTablesAction()).resolves.toEqual({ success: false, error: 'You are not a member of this workspace' })
        expect(engine.listDbTables).not.toHaveBeenCalled()
    })

    it('still fails when the machine does not answer', async () => {
        vi.mocked(engine.listBrainPages).mockRejectedValue(new Error('fetch failed'))
        vi.mocked(engine.countBrainProposals).mockResolvedValue(0)
        vi.mocked(engine.listDbTables).mockRejectedValue(new Error('fetch failed'))
        vi.mocked(engine.listFiles).mockRejectedValue(new Error('fetch failed'))
        await expect(loadBrainAction()).rejects.toThrow('fetch failed')
        await expect(listWorkspaceTablesAction()).resolves.toEqual({ success: false, error: 'Could not reach the machine of this workspace.', code: 'workspaceMachineUnreachable' })
        await expect(listWorkspaceFilesAction()).rejects.toThrow('fetch failed')
    })
})
