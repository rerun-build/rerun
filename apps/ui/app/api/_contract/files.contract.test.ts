import { mobileApi } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { forgetMachine } from '@/lib/engine/engine-memory'
import { callRoute, contractContext, contractSessionUser, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, type FakeSupabase } from '@/test/supabase-fake'

type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Partial<Tables[T]['Row']>
type Storage = NonNullable<Parameters<typeof import('@/lib/storage/private').uploadPrivateFile>[0]>['storage']

// What the composer sends and shows: a file for a coworker's folder or for the Chief of Staff, the
// file read back for its preview, and a voice note turned into text. The bytes go to the engine, to
// the foreman's bucket and to OpenRouter, which are what is replaced.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null }))

const engine = vi.hoisted(() => ({
    supportsStreamedUploads: vi.fn<typeof import('@/lib/engine/client').supportsStreamedUploads>(),
    uploadFileStream: vi.fn<typeof import('@/lib/engine/client').uploadFileStream>(),
    uploadFile: vi.fn<typeof import('@/lib/engine/client').uploadFile>(),
    fetchRawFile: vi.fn<typeof import('@/lib/engine/client').fetchRawFile>(),
}))

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/supabase/session/getServerSession', async importOriginal => {
    const original = await importOriginal<typeof import('@/supabase/session/getServerSession')>()
    return {
        ...original,
        getAuthUser: async () => state.ctx?.authUser,
        getSessionWorkspace: async (): ReturnType<typeof original.getSessionWorkspace> => {
            const ctx = state.ctx!
            return { supabase: ctx.supabase, user: contractSessionUser(ctx.userId, ctx.workspace.id), workspaceRefused: false, membership: { role: ctx.role, box_scope: ctx.boxScope } }
        },
    }
})
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), ...engine }))

type AgentRow = Row<'agents'> & { space: Pick<Tables['spaces']['Row'], 'visibility'> }

const agents: AgentRow[] = [{ id: 'agent-scout', name: 'Scout', workspace_id: 7, space_id: 'space-sales', engine_agent_id: 'eng-scout', disabled_at: null, disabled_reason: null, space: { visibility: 'workspace' } }]
const engine_pool: Row<'engine_pool'>[] = [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', claimed_by_workspace_id: 7 }]
const spaces: Row<'spaces'>[] = [{ id: 'space-sales', workspace_id: 7, visibility: 'workspace' }]

// The foreman's bucket, held in memory the way Storage keeps an object: its bytes and its type.
function memoryStorage() {
    const objects = new Map<string, Blob>()
    const storage = {
        createBucket: async () => ({ data: null, error: null }),
        from: (bucket: string) => ({
            upload: async (path: string, body: Uint8Array<ArrayBuffer>, options: { contentType: string }) => {
                objects.set(`${bucket}/${path}`, new Blob([body], { type: options.contentType }))
                return { data: { path }, error: null }
            },
            download: async (path: string) => {
                const blob = objects.get(`${bucket}/${path}`)
                return blob ? { data: blob, error: null } : { data: null, error: { name: 'StorageApiError', status: 400, message: 'Object not found' } }
            },
        }),
    }
    return { objects, storage: storage as unknown as Storage }
}

const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')
const voiceNote = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])

let bucket: ReturnType<typeof memoryStorage>

beforeEach(() => {
    forgetMachine(7)
    const db = fakeSupabase(tableResolver({ agents, engine_pool, spaces, space_members: [] }))
    bucket = memoryStorage()
    Object.assign(db.client, { storage: bucket.storage })
    state.db = db
    state.ctx = contractContext(db)
    engine.supportsStreamedUploads.mockReset().mockResolvedValue(true)
    engine.uploadFileStream.mockReset().mockImplementation(async (_conn, _base, input) => ({ path: [input.dir, input.name].filter(Boolean).join('/'), bytes: (await new Response(input.body).arrayBuffer()).byteLength }))
    engine.uploadFile.mockReset().mockResolvedValue()
    engine.fetchRawFile.mockReset()
})

describe("a coworker's files", () => {
    it("streams a file into the coworker's folder", async () => {
        const { POST } = await import('@/app/api/files/stream/route')
        const res = await callRoute(POST, mobileApi.uploadAgentFile, { query: { agentId: 'agent-scout', name: 'brief.pdf', size: String(pdf.byteLength), dir: 'uploads' }, body: pdf })
        expect(await expectContract(mobileApi.uploadAgentFile, res)).toEqual({ path: 'uploads/brief.pdf' })
        expect(engine.uploadFileStream).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), '/agents/eng-scout/files', expect.objectContaining({ name: 'brief.pdf', dir: 'uploads', size: pdf.byteLength }))
    })

    it('carries the file through the older route of an engine that predates streamed uploads', async () => {
        engine.supportsStreamedUploads.mockResolvedValue(false)
        const { POST } = await import('@/app/api/files/stream/route')
        const res = await callRoute(POST, mobileApi.uploadAgentFile, { query: { scope: 'shared', name: 'brief.pdf', size: String(pdf.byteLength) }, body: pdf })
        expect(await expectContract(mobileApi.uploadAgentFile, res)).toEqual({ path: 'brief.pdf' })
        expect(engine.uploadFile).toHaveBeenCalledWith(expect.anything(), '/shared/files', expect.any(File), '')
    })

    it('reads a file back for its preview', async () => {
        engine.fetchRawFile.mockResolvedValue(new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(pdf.byteLength), 'Accept-Ranges': 'bytes' } }))
        const { GET } = await import('@/app/api/files/raw/route')
        const res = await callRoute(GET, mobileApi.readAgentFile, { query: { agentId: 'agent-scout', path: 'uploads/brief.pdf' } })
        expect(await expectContract(mobileApi.readAgentFile, res)).toEqual(pdf)
        expect(res.headers.get('content-type')).toBe('application/pdf')
    })
})

describe("the Chief of Staff's files", () => {
    it('keeps an attachment in the conversation it was sent to', async () => {
        const { POST } = await import('@/app/api/foreman/files/stream/route')
        const res = await callRoute(POST, mobileApi.uploadForemanFile, { query: { sessionId: 'fm-general', name: 'note.m4a', size: String(voiceNote.byteLength), dir: 'voice' }, body: voiceNote })
        expect(await expectContract(mobileApi.uploadForemanFile, res)).toEqual({ path: 'voice/note.m4a' })
        expect([...bucket.objects.keys()]).toEqual(['foreman-files/7/user-ada/fm-general/voice/note.m4a'])
    })

    it('reads an attachment back', async () => {
        bucket.objects.set('foreman-files/7/user-ada/fm-general/voice/note.m4a', new Blob([voiceNote], { type: 'application/octet-stream' }))
        const { GET } = await import('@/app/api/foreman/files/raw/route')
        const res = await callRoute(GET, mobileApi.readForemanFile, { query: { sessionId: 'fm-general', path: 'voice/note.m4a' } })
        expect(await expectContract(mobileApi.readForemanFile, res)).toEqual(voiceNote)
        expect(res.headers.get('content-type')).toBe('audio/mp4')
    })
})

describe('a voice note', () => {
    let openRouter: MockInstance<typeof fetch>

    beforeEach(() => {
        vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
        openRouter = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ text: ' Call Maison Pozzoli back tomorrow. ' }))
    })

    afterEach(() => {
        openRouter.mockRestore()
        vi.unstubAllEnvs()
    })

    it('comes back as its transcript', async () => {
        const { POST } = await import('@/app/api/voice/transcribe/route')
        const res = await callRoute(POST, mobileApi.transcribeVoice, { query: { format: 'm4a' }, body: voiceNote })
        expect(await expectContract(mobileApi.transcribeVoice, res)).toEqual({ text: 'Call Maison Pozzoli back tomorrow.' })
        expect(JSON.parse(String(openRouter.mock.calls[0][1]?.body))).toMatchObject({ input_audio: { format: 'm4a', data: Buffer.from(voiceNote).toString('base64') } })
    })
})
