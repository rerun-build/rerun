import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-files-stream-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { mkdir } = await import('node:fs/promises')
const { agentDir, workspaceDir } = await import('../../config/paths.js')
const { MAX_UPLOAD_FILE_BYTES } = await import('@moldwright/contracts')

const id = 'streamagent'
const app = createServer()

function bodyOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}

function put(path: string, bytes: Uint8Array): Promise<Response> {
    return app.request(path, { method: 'PUT', body: bodyOf(bytes), duplex: 'half' } as RequestInit)
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await mkdir(workspaceDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'stream agent' }))
})

describe('streaming a file into a workspace', () => {
    it('writes the bytes and creates the parent directories', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5])
        const res = await put(`/agents/${id}/files/raw?dir=chat-uploads/nested&name=blob.bin`, bytes)

        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({ path: 'chat-uploads/nested/blob.bin', bytes: 5 })
        expect(readFileSync(resolve(workspaceDir(id), 'chat-uploads/nested/blob.bin'))).toEqual(Buffer.from(bytes))
    })

    it('needs a name or a path', async () => {
        const res = await put(`/agents/${id}/files/raw?dir=chat-uploads`, new Uint8Array([1]))
        expect(res.status).toBe(400)
    })

    it('refuses a directory that escapes the workspace', async () => {
        const res = await put(`/agents/${id}/files/raw?dir=../../..&name=escaped.bin`, new Uint8Array([1]))
        expect(res.status).toBe(400)
    })

    it('refuses an oversized file on its declared size alone', async () => {
        const res = await put(`/agents/${id}/files/raw?name=declared.bin&size=${MAX_UPLOAD_FILE_BYTES + 1}`, new Uint8Array([1]))
        expect(res.status).toBe(400)
    })

    it('caps a body that outgrows the limit and leaves no partial file', async () => {
        const cap = 64
        const oversized = new Uint8Array(cap + 1)
        const root = resolve(process.env.RERUN_DATA_DIR!, 'shared')
        await mkdir(root, { recursive: true })

        const store = await import('../../files/store.js')
        await expect(store.writeStream(root, 'too-big.bin', bodyOf(oversized), cap)).rejects.toThrow(/upload limit/)
        expect(readdirSync(root)).toEqual([])
    })
})
