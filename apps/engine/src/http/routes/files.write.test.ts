import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-files-write-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { mkdir } = await import('node:fs/promises')
const { agentDir, workspaceDir } = await import('../../config/paths.js')
const { MAX_TEXT_WRITE_CHARS } = await import('@moldwright/contracts')

const id = 'writeagent'
const app = createServer()

function write(path: string, content: string): Promise<Response> {
    return app.request(`/agents/${id}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
    })
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await mkdir(workspaceDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'write agent' }))
})

describe('writing a text file into a workspace', () => {
    it('writes the content and creates the parent directories', async () => {
        const res = await write('notes/deep/todo.md', '# Todo\nship it\n')

        expect(res.status).toBe(201)
        expect(readFileSync(resolve(workspaceDir(id), 'notes/deep/todo.md'), 'utf8')).toBe('# Todo\nship it\n')
    })

    it('reads back what it wrote', async () => {
        await write('notes/roundtrip.txt', 'line one\nline two')
        const res = await app.request(`/agents/${id}/files/read?path=notes/roundtrip.txt`)

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ content: 'line one\nline two', truncated: false })
    })

    it('overwrites an existing file', async () => {
        await write('notes/overwrite.txt', 'before')
        await write('notes/overwrite.txt', 'after')
        expect(readFileSync(resolve(workspaceDir(id), 'notes/overwrite.txt'), 'utf8')).toBe('after')
    })

    it('refuses a path that escapes the workspace', async () => {
        const res = await write('../../escaped.txt', 'nope')
        expect(res.status).toBe(400)
    })

    it('refuses content past the write cap', async () => {
        const res = await write('notes/huge.txt', 'x'.repeat(MAX_TEXT_WRITE_CHARS + 1))
        expect(res.status).toBe(400)
    })
})
