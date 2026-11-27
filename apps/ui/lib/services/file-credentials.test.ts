import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supportsMcpFileSecrets } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { checkFileCredentials } from './file-credentials'
import { getMethod, serviceManifestSchema } from './manifest'

vi.mock('@/lib/engine/client', () => ({ supportsMcpFileSecrets: vi.fn(async () => true) }))

const firebase = serviceManifestSchema.parse({
    slug: 'firebase',
    name: 'Firebase',
    inputs: [
        { key: 'FIREBASE_SERVICE_ACCOUNT', label: 'Service account JSON', type: 'password', secret: true, multiline: true },
        { key: 'PROJECT', label: 'Project', required: false },
    ],
    mcpServers: [{ name: 'firebase', transport: 'stdio', command: 'npx', env: { GOOGLE_APPLICATION_CREDENTIALS: '${file:input.FIREBASE_SERVICE_ACCOUNT}', PROJECT: '${input.PROJECT}' } }],
})
const method = getMethod(firebase)
const engine = async () => ({}) as EngineConnection

describe('checkFileCredentials', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(supportsMcpFileSecrets).mockResolvedValue(true)
    })

    it('puts a JSON pasted over several lines back on one, its escapes untouched', async () => {
        const pasted = '{\n  "type": "service_account",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"\n}\n'
        const checked = await checkFileCredentials(firebase, method, { FIREBASE_SERVICE_ACCOUNT: pasted, PROJECT: 'demo' }, engine)
        expect(checked.FIREBASE_SERVICE_ACCOUNT).toBe('{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"}')
        expect(checked.FIREBASE_SERVICE_ACCOUNT).not.toMatch(/[\r\n]/)
        expect(checked.PROJECT).toBe('demo')
    })

    it('refuses a value that is not JSON, naming the field', async () => {
        await expect(checkFileCredentials(firebase, method, { FIREBASE_SERVICE_ACCOUNT: 'not json' }, engine)).rejects.toMatchObject({ code: 'serviceCredentialNotJson', params: { name: 'Firebase', field: 'Service account JSON' } })
    })

    it('refuses an engine that would hand the server the placeholder itself', async () => {
        vi.mocked(supportsMcpFileSecrets).mockResolvedValue(false)
        await expect(checkFileCredentials(firebase, method, { FIREBASE_SERVICE_ACCOUNT: '{}' }, engine)).rejects.toMatchObject({ code: 'serviceNeedsEngineUpdate', params: { name: 'Firebase' } })
    })

    it('asks nothing of the engine for an app without a file credential', async () => {
        const plain = serviceManifestSchema.parse({ slug: 'x', name: 'X', inputs: [{ key: 'K', label: 'Key', secret: true }], mcpServers: [{ name: 'x', url: 'https://x.test', headers: { Authorization: 'Bearer ${input.K}' } }] })
        const values = { K: 'multi\nline' }
        expect(await checkFileCredentials(plain, getMethod(plain), values, engine)).toBe(values)
        expect(supportsMcpFileSecrets).not.toHaveBeenCalled()
    })
})
