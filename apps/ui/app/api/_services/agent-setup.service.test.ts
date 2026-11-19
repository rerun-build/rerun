import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compileService } from '@/lib/services/compiler'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { declareService } from './agent-setup.service'
import { installService, markServiceNeedsConfig } from './services.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/services/compiler', () => ({ compileService: vi.fn() }))
vi.mock('./agent.service', () => ({ createAgent: vi.fn() }))
vi.mock('./services.service', () => ({ installService: vi.fn(), markServiceNeedsConfig: vi.fn(), toAuthMethodSummaries: vi.fn(() => []) }))

const oauthMethod = { id: 'oauth', kind: 'oauth', mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.test/mcp' }] }
const keyMethod = { id: 'key', kind: 'key', inputs: [{ key: 'TOKEN', label: 'Token', secret: true, required: true }], mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.test/mcp' }] }
const oneWay = serviceManifestSchema.parse({ slug: 'linear', name: 'Linear', authMethods: [oauthMethod] })
const severalWays = serviceManifestSchema.parse({ slug: 'linear', name: 'Linear', authMethods: [oauthMethod, keyMethod] })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(installService).mockResolvedValue({ status: 'needs_auth', key: 'linear', slug: 'linear', name: 'Linear', message: '' })
})

describe('declareService', () => {
    it("compiles a coworker's app in its own folder, or leaves it to configure", async () => {
        await expect(declareService('agent-1', oneWay)).resolves.toBe('compiled')
        expect(compileService).toHaveBeenCalledWith('agent-1', oneWay, {}, 'oauth', undefined, undefined)

        await expect(declareService('agent-1', severalWays)).resolves.toBe('needs_config')
        expect(markServiceNeedsConfig).toHaveBeenCalledWith('agent-1', 'linear', undefined, undefined, undefined)
        expect(installService).not.toHaveBeenCalled()
    })

    it('goes through the Vault install for the Chief of Staff, which keeps its apps nowhere else', async () => {
        await expect(declareService('foreman', oneWay)).resolves.toBe('compiled')
        expect(installService).toHaveBeenCalledWith('foreman', 'linear', {}, 'oauth', undefined, { pending: false })
        expect(compileService).not.toHaveBeenCalled()
    })

    it('leaves an app with several ways to connect pending on the Chief of Staff, under the account it was declared as', async () => {
        vi.mocked(installService).mockResolvedValue({ status: 'needs_config', key: 'linear@k3x9ab', slug: 'linear', name: 'Linear', authMethods: [], message: '' })
        await expect(declareService('foreman', severalWays, undefined, { key: 'linear@k3x9ab', instanceId: 'k3x9ab', label: 'Linear 2' })).resolves.toBe('needs_config')
        expect(installService).toHaveBeenCalledWith('foreman', 'linear@k3x9ab', {}, undefined, undefined, { pending: true })
        expect(markServiceNeedsConfig).not.toHaveBeenCalled()
    })
})
