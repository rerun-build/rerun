import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    resolveAgentTarget: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    visibleSpaceIds: vi.fn(),
    assertSpaceAccess: vi.fn(),
    memberEmailOf: vi.fn(),
    dispatchConversationTool: vi.fn(),
    listMemories: vi.fn(),
    recallMemories: vi.fn(),
    deleteMemory: vi.fn(),
    listFiles: vi.fn(),
    readFileText: vi.fn(),
    listBrainPages: vi.fn(),
    readBrainPage: vi.fn(),
    writeBrainPage: vi.fn(),
    setBrainPageMeta: vi.fn(),
    deleteBrainPage: vi.fn(),
}))

class EngineRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
    }
}
class NoEngineError extends Error {}

vi.mock('./chat.service', () => ({ resolveAgentTarget: mocks.resolveAgentTarget }))
vi.mock('./workspace-engine.service', () => ({ getWorkspaceConnection: mocks.getWorkspaceConnection, NoEngineError }))
vi.mock('./mcp-conversations.service', () => ({ dispatchConversationTool: mocks.dispatchConversationTool }))
vi.mock('@/app/api/_auth/access', () => ({ visibleSpaceIds: mocks.visibleSpaceIds, assertSpaceAccess: mocks.assertSpaceAccess }))
vi.mock('@/lib/mcp/member', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/mcp/member')>()), memberEmailOf: mocks.memberEmailOf }))
vi.mock('@/lib/brand/workspace', () => ({ workspaceBrand: vi.fn(async () => ({ name: 'Nordlys' })) }))
vi.mock('@/lib/engine/client', () => ({
    EngineRequestError,
    SHARED_FILES_BASE: '/shared/files',
    agentFilesBase: (id: string) => `/agents/${id}/files`,
    listMemories: mocks.listMemories,
    recallMemories: mocks.recallMemories,
    deleteMemory: mocks.deleteMemory,
    listFiles: mocks.listFiles,
    readFileText: mocks.readFileText,
    listBrainPages: mocks.listBrainPages,
    readBrainPage: mocks.readBrainPage,
    writeBrainPage: mocks.writeBrainPage,
    setBrainPageMeta: mocks.setBrainPageMeta,
    deleteBrainPage: mocks.deleteBrainPage,
}))

const { dispatchKnowledgeTool } = await import('./mcp-knowledge.service')

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const MEMBER: Actor = { kind: 'user', userId: 'u-ada', workspaceId: 7, role: 'member', boxScope: 'assigned' }
const STAFF: Actor = { kind: 'user', userId: 'u-staff', workspaceId: 7, role: 'admin', boxScope: 'all', organizationStaff: true }
const WORKSPACE: Actor = { kind: 'workspace', workspaceId: 7 }

const memory = (id: string, createdAt: string, kind = 'note', tags: string[] = []) => ({ id, kind, tags, createdAt, content: `memory ${id}`, accessCount: 3, strength: 0.4 })
const page = (slug: string, spaceId: string | null, type = 'company') => ({ slug, title: slug, type, hash: `h-${slug}`, updatedAt: '2026-11-20', updatedBy: 'user:ada', tags: [], createdBy: null, spaceId })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAgentTarget.mockResolvedValue({ conn, engineAgentId: 'engine-lea' })
    mocks.getWorkspaceConnection.mockResolvedValue(conn)
    mocks.visibleSpaceIds.mockResolvedValue(new Set(['box-sales']))
    mocks.memberEmailOf.mockResolvedValue('ada@acme.test')
})

describe('memories', () => {
    beforeEach(() => {
        mocks.listMemories.mockResolvedValue([memory('m1', '2026-11-01'), memory('m2', '2026-11-03', 'preference', ['report']), memory('m3', '2026-11-02', 'preference')])
    })

    it('lists newest first, filtered and paged on the hub, without the recall internals', async () => {
        const out = await dispatchKnowledgeTool(MEMBER, 'list_memories', { agentId: 'agent-lea', kind: 'preference', limit: 1 })
        expect(mocks.resolveAgentTarget).toHaveBeenCalledWith('agent-lea', 'use', MEMBER)
        expect(out).toEqual({ memories: [{ id: 'm2', kind: 'preference', tags: ['report'], content: 'memory m2', createdAt: '2026-11-03' }], total: 2, nextOffset: 1 })

        await expect(dispatchKnowledgeTool(MEMBER, 'list_memories', { agentId: 'agent-lea', tag: 'report' })).resolves.toMatchObject({ total: 1, nextOffset: null })
    })

    it('recalls by meaning, at most 20', async () => {
        mocks.recallMemories.mockResolvedValue([memory('m2', '2026-11-03')])
        await dispatchKnowledgeTool(MEMBER, 'recall_memories', { agentId: 'agent-lea', query: 'weekly report', limit: 99 })
        expect(mocks.recallMemories).toHaveBeenCalledWith(conn, 'engine-lea', { query: 'weekly report', limit: 20 })
    })

    it('deletes one memory with Can manage, and only once confirmed', async () => {
        await expect(dispatchKnowledgeTool(MEMBER, 'delete_memory', { agentId: 'agent-lea', memoryId: 'm1' })).rejects.toThrow('confirm: true')
        expect(mocks.deleteMemory).not.toHaveBeenCalled()

        await expect(dispatchKnowledgeTool(MEMBER, 'delete_memory', { agentId: 'agent-lea', memoryId: 'm1', confirm: true })).resolves.toEqual({ memoryId: 'm1', deleted: true })
        expect(mocks.resolveAgentTarget).toHaveBeenCalledWith('agent-lea', 'manage', MEMBER)
    })

    it('names a memory the coworker does not hold', async () => {
        mocks.deleteMemory.mockRejectedValue(new EngineRequestError('gone', 404))
        await expect(dispatchKnowledgeTool(MEMBER, 'delete_memory', { agentId: 'agent-lea', memoryId: 'nope', confirm: true })).rejects.toThrow('No memory "nope"')
    })
})

describe('files', () => {
    it('lists a coworker folder through its own access, and the shared folder for any member, without hidden files', async () => {
        mocks.listFiles.mockResolvedValue([
            { name: 'q1.md', type: 'file', size: 12 },
            { name: '.git', type: 'dir', size: 0 },
        ])
        await expect(dispatchKnowledgeTool(MEMBER, 'list_files', { agentId: 'agent-lea', path: '/reports/' })).resolves.toEqual({ path: 'reports', entries: [{ name: 'q1.md', path: 'reports/q1.md', type: 'file', bytes: 12 }] })
        expect(mocks.listFiles).toHaveBeenCalledWith(conn, '/agents/engine-lea/files', 'reports')

        await dispatchKnowledgeTool(MEMBER, 'list_files', { shared: true })
        expect(mocks.listFiles).toHaveBeenLastCalledWith(conn, '/shared/files', '.')
        expect(mocks.getWorkspaceConnection).toHaveBeenCalledWith(7)
    })

    it('asks where to read, and never both', async () => {
        await expect(dispatchKnowledgeTool(MEMBER, 'list_files', {})).rejects.toThrow('shared: true')
        await expect(dispatchKnowledgeTool(MEMBER, 'list_files', { agentId: 'agent-lea', shared: true })).rejects.toThrow('not both')
    })

    it('reads a text file a page at a time, and refuses a binary one before reaching the machine', async () => {
        mocks.readFileText.mockResolvedValue({ path: 'notes.md', content: 'hello', offset: 0, nextOffset: null, totalChars: 5, truncated: false })
        await expect(dispatchKnowledgeTool(MEMBER, 'read_file', { shared: true, path: 'notes.md' })).resolves.toEqual({ path: 'notes.md', content: 'hello', offset: 0, nextOffset: null, totalChars: 5, truncated: false })

        await expect(dispatchKnowledgeTool(MEMBER, 'read_file', { shared: true, path: 'logo.png' })).rejects.toThrow('not a text file')
        expect(mocks.readFileText).toHaveBeenCalledTimes(1)
    })

    it('says so when the workspace has no machine yet', async () => {
        mocks.getWorkspaceConnection.mockRejectedValue(new NoEngineError())
        await expect(dispatchKnowledgeTool(MEMBER, 'list_files', { shared: true })).rejects.toThrow('no machine yet')
    })
})

describe('the Brain', () => {
    it('lists every page, the ones filed under a Box the caller cannot open reading as filed for everyone', async () => {
        mocks.listBrainPages.mockResolvedValue([page('pricing', 'box-sales', 'offering'), page('hiring', 'box-hr'), page('company', null)])
        const out = (await dispatchKnowledgeTool(MEMBER, 'list_brain_pages', {})) as { pages: { slug: string; spaceId: string | null }[] }
        expect(out.pages.map(({ slug, spaceId }) => ({ slug, spaceId }))).toEqual([
            { slug: 'pricing', spaceId: 'box-sales' },
            { slug: 'hiring', spaceId: null },
            { slug: 'company', spaceId: null },
        ])

        await expect(dispatchKnowledgeTool(MEMBER, 'list_brain_pages', { spaceId: 'box-hr' })).resolves.toEqual({ pages: [] })
        await expect(dispatchKnowledgeTool(MEMBER, 'list_brain_pages', { type: 'offering' })).resolves.toMatchObject({ pages: [{ slug: 'pricing' }] })
    })

    it('writes a page signed by the member, then files it under a Box they reach', async () => {
        mocks.writeBrainPage.mockResolvedValue({ page: { hash: 'h1', title: 'Pricing', spaceId: null }, revisions: [] })
        mocks.setBrainPageMeta.mockResolvedValue({ page: { hash: 'h1', title: 'Pricing', spaceId: 'box-sales' }, revisions: [] })

        await expect(dispatchKnowledgeTool(MEMBER, 'write_brain_page', { slug: 'pricing', title: 'Pricing', type: 'offering', content: '$29', baseHash: null, spaceId: 'box-sales' })).resolves.toEqual({ slug: 'pricing', hash: 'h1', title: 'Pricing', spaceId: 'box-sales', created: true })
        expect(mocks.assertSpaceAccess).toHaveBeenCalledWith('box-sales', 'use', MEMBER)
        expect(mocks.writeBrainPage).toHaveBeenCalledWith(conn, 'pricing', { title: 'Pricing', type: 'offering', content: '$29', sources: [], baseHash: null, author: 'user:ada@acme.test' })
        expect(mocks.setBrainPageMeta).toHaveBeenCalledWith(conn, 'pricing', { spaceId: 'box-sales' })
    })

    it('keeps a page written whose filing failed, for everyone, and says how to file it', async () => {
        mocks.writeBrainPage.mockResolvedValue({ page: { hash: 'h1', title: 'Pricing', spaceId: null }, revisions: [] })
        mocks.setBrainPageMeta.mockRejectedValue(new EngineRequestError('missing', 404))
        const out = await dispatchKnowledgeTool(MEMBER, 'write_brain_page', { slug: 'pricing', title: 'Pricing', type: 'offering', content: '$29', baseHash: null, spaceId: 'box-sales' })
        expect(out).toMatchObject({ slug: 'pricing', hash: 'h1', spaceId: null, created: true, note: expect.stringContaining('baseHash "h1"') })
    })

    it('signs with the brand for the team of the organization that runs the workspace', async () => {
        mocks.writeBrainPage.mockResolvedValue({ page: { hash: 'h1', title: 'Pricing', spaceId: null }, revisions: [] })
        await dispatchKnowledgeTool(STAFF, 'write_brain_page', { slug: 'pricing', title: 'Pricing', type: 'offering', content: '$29', baseHash: 'h0' })
        expect(mocks.writeBrainPage.mock.calls[0][2]).toMatchObject({ author: 'user:Nordlys', baseHash: 'h0' })
    })

    it('turns a stale write into a sentence that says what to do', async () => {
        mocks.writeBrainPage.mockRejectedValue(new EngineRequestError('conflict', 409))
        await expect(dispatchKnowledgeTool(MEMBER, 'write_brain_page', { slug: 'pricing', title: 'Pricing', type: 'offering', content: 'x', baseHash: 'old' })).rejects.toThrow('get_brain_page')
    })

    it('refuses what the engine would refuse, and a key with nobody behind it', async () => {
        await expect(dispatchKnowledgeTool(MEMBER, 'write_brain_page', { slug: 'Pricing Page', title: 'P', type: 'offering', content: 'x', baseHash: null })).rejects.toThrow('kebab-case')
        await expect(dispatchKnowledgeTool(MEMBER, 'write_brain_page', { slug: 'pricing', title: 'P', type: 'memo', content: 'x', baseHash: null })).rejects.toThrow('Unknown page type')
        await expect(dispatchKnowledgeTool(MEMBER, 'write_brain_page', { slug: 'pricing', title: 'P', type: 'note', content: 'x'.repeat(60_001), baseHash: null })).rejects.toThrow('60000')
        await expect(dispatchKnowledgeTool(WORKSPACE, 'write_brain_page', { slug: 'pricing', title: 'P', type: 'note', content: 'x', baseHash: null })).rejects.toThrow('acts for the workspace')
        expect(mocks.writeBrainPage).not.toHaveBeenCalled()
    })

    it('names a page that does not exist', async () => {
        mocks.readBrainPage.mockRejectedValue(new EngineRequestError('missing', 404))
        await expect(dispatchKnowledgeTool(MEMBER, 'get_brain_page', { slug: 'nope' })).rejects.toThrow('No page "nope"')
    })

    it('deletes a page once confirmed', async () => {
        await expect(dispatchKnowledgeTool(MEMBER, 'delete_brain_page', { slug: 'pricing' })).rejects.toThrow('confirm: true')
        await expect(dispatchKnowledgeTool(MEMBER, 'delete_brain_page', { slug: 'pricing', confirm: true })).resolves.toEqual({ slug: 'pricing', deleted: true })
    })
})

it('hands any other name to the conversations', async () => {
    await dispatchKnowledgeTool(MEMBER, 'list_conversations', { agentId: 'agent-lea' })
    expect(mocks.dispatchConversationTool).toHaveBeenCalledWith(MEMBER, 'list_conversations', { agentId: 'agent-lea' })
})
