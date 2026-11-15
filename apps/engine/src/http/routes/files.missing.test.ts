import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-files-missing-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { mkdir } = await import('node:fs/promises')
const { agentDir } = await import('../../config/paths.js')

const id = 'filesagent'
const app = createServer()

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'files agent' }))
})

describe('reading a file that is not there', () => {
    it('answers 404, not 500', async () => {
        const res = await app.request(`/agents/${id}/files/read?path=${encodeURIComponent('.rerun/services.json')}`)
        expect(res.status).toBe(404)
    })

    it('still rejects a path escaping the root with 400', async () => {
        const res = await app.request(`/agents/${id}/files/read?path=${encodeURIComponent('../../../etc/passwd')}`)
        expect(res.status).toBe(400)
    })

    it('still refuses a request with no path at all', async () => {
        const res = await app.request(`/agents/${id}/files/read`)
        expect(res.status).toBe(400)
    })
})
