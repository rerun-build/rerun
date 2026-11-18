import { visibleSpaceIds } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { syncCoworkerBoxes } from '@/app/api/_services/coworker-box.service'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listBrainProposalsAction, loadBrainAction, setBrainFilesMetaAction } from './brain.actions'
import { listWorkspaceTablesAction } from './workspace-db.actions'
import { listWorkspaceFilesAction } from './workspace-file.actions'

vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ actorFromContext: (ctx: unknown) => ctx, visibleSpaceIds: vi.fn() }))
vi.mock('@/app/api/_services/coworker-box.service', () => ({ syncCoworkerBoxes: vi.fn() }))
const rows = vi.hoisted(() => ({ spaces: [] as unknown[], agents: [] as unknown[] }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: async (_client: unknown, table: string) => ({ data: table === 'spaces' ? rows.spaces : rows.agents }) }))
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
    listBrainFileMeta: vi.fn(),
    setBrainFileMeta: vi.fn(),
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

describe('the Boxes the Brain files under', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(requireWorkspaceConnection).mockResolvedValue(conn)
        vi.mocked(requireWorkspaceContext).mockResolvedValue({ workspace: { id: 7 }, userId: 'u1', userEmail: 'theo@example.com', supabase: {} } as never)
        vi.mocked(engine.listBrainPages).mockResolvedValue([])
        vi.mocked(engine.countBrainProposals).mockResolvedValue(0)
        rows.spaces = [
            { id: 'b2', name: 'Support', sidebar_order: 2, created_at: '2026-01-02' },
            { id: 'b1', name: ' ', sidebar_order: 1, created_at: '2026-01-01' },
            { id: 'hidden', name: 'Board', sidebar_order: 0, created_at: '2026-01-01' },
        ]
        rows.agents = [
            { id: 'a1', name: 'Lead Finder', handle: 'lead-finder', space_id: 'b1', engine_agent_id: 'e1' },
            { id: 'a2', name: 'CFO', handle: 'cfo', space_id: 'hidden', engine_agent_id: 'e2' },
        ]
    })

    it('lists only the Boxes the person can open, in the sidebar order, and sends the engine the coworkers\' Boxes', async () => {
        vi.mocked(visibleSpaceIds).mockResolvedValue(new Set(['b1', 'b2']))
        vi.mocked(engine.listBrainFileMeta).mockResolvedValue([{ path: 'deck.pdf', kind: 'file', tags: ['acme'], createdBy: 'user:theo', spaceId: 'b1', createdAt: '2026-01-01' }])
        await expect(loadBrainAction()).resolves.toEqual({
            available: true,
            pages: [],
            openProposals: 0,
            boxes: [
                { id: 'b1', name: null },
                { id: 'b2', name: 'Support' },
            ],
            coworkers: [{ id: 'a1', name: 'Lead Finder', handle: 'lead-finder', spaceId: 'b1' }],
            files: [{ path: 'deck.pdf', kind: 'file', tags: ['acme'], createdBy: 'user:theo', spaceId: 'b1', createdAt: '2026-01-01' }],
        })
        expect(syncCoworkerBoxes).toHaveBeenCalledWith(7)
    })

    it('reads the files of an engine from before filing as unfiled', async () => {
        vi.mocked(visibleSpaceIds).mockResolvedValue('all')
        vi.mocked(engine.listBrainFileMeta).mockRejectedValue(new engine.EngineRequestError('failed: 404', 404))
        const overview = await loadBrainAction()
        expect(overview).toMatchObject({ available: true, files: [] })
        expect(overview.available && overview.boxes.map(box => box.id)).toEqual(['hidden', 'b1', 'b2'])
    })

    it('files an import as the person who made it', async () => {
        vi.mocked(engine.setBrainFileMeta).mockResolvedValue([])
        await expect(setBrainFilesMetaAction({ paths: ['brand-kit', 'brand-kit/logo.svg'], tags: ['brand'], spaceId: 'b2' })).resolves.toEqual({ ok: true, value: [] })
        expect(engine.setBrainFileMeta).toHaveBeenCalledWith(undefined, { paths: ['brand-kit', 'brand-kit/logo.svg'], tags: ['brand'], spaceId: 'b2', author: 'user:theo@example.com' })
    })
})
