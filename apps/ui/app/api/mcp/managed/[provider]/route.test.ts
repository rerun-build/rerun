import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { getManagedProvider } from '@/lib/managed/registry'
import type { ManagedProvider } from '@/lib/managed/types'
import { POST } from './route'

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn() }))
vi.mock('@/lib/managed/registry', () => ({ getManagedProvider: vi.fn() }))

const BOX_KEY = 'box-key-of-workspace-7'

const listForms = vi.fn()

const provider: ManagedProvider = {
    id: 'typeform',
    label: 'Typeform',
    oauth: { authorizationEndpoint: 'https://auth.test', tokenEndpoint: 'https://token.test', scopes: [], clientIdEnv: 'X', clientSecretEnv: 'Y' },
    tools: [{ name: 'list_forms', description: 'List forms', inputSchema: { type: 'object' }, execute: listForms }],
}

function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request('https://rerun.test/api/mcp/managed/typeform', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rerun-key': BOX_KEY, authorization: 'Bearer third-party-token', ...headers },
        body: JSON.stringify(body),
    })
}

function context(providerId = 'typeform') {
    return { params: Promise.resolve({ provider: providerId }) }
}

function toolCall(name: string) {
    return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { page: 2 } } }
}

describe('POST /api/mcp/managed/[provider]', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(getManagedProvider).mockImplementation(id => (id === provider.id ? provider : undefined))
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === BOX_KEY ? { workspaceId: 7, isSandbox: false } : null))
        listForms.mockResolvedValue({ items: [] })
    })

    it('answers 404 for a provider Moldwright does not manage', async () => {
        const response = await POST(request(toolCall('list_forms')), context('gmail'))

        expect(response.status).toBe(404)
        expect(listForms).not.toHaveBeenCalled()
    })

    it('answers 401 without an engine key', async () => {
        const response = await POST(request(toolCall('list_forms'), { 'x-rerun-key': '' }), context())

        expect(response.status).toBe(401)
        expect(listForms).not.toHaveBeenCalled()
    })

    it('answers 401 with an engine key that names no machine', async () => {
        const response = await POST(request(toolCall('list_forms'), { 'x-rerun-key': 'forged-key' }), context())

        expect(response.status).toBe(401)
        expect(authenticateEngineToken).toHaveBeenCalledWith('forged-key')
        expect(listForms).not.toHaveBeenCalled()
    })

    it('refuses a tool the provider does not define with -32601', async () => {
        const response = await POST(request(toolCall('delete_account')), context())

        expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unknown tool: delete_account' } })
        expect(listForms).not.toHaveBeenCalled()
    })

    it('answers a tool call without a third-party token with a not connected tool error', async () => {
        const response = await POST(request(toolCall('list_forms'), { authorization: '' }), context())

        expect(await response.json()).toMatchObject({ result: { isError: true } })
        expect(listForms).not.toHaveBeenCalled()
    })

    it('runs the tool with the forwarded third-party token', async () => {
        const response = await POST(request(toolCall('list_forms')), context())

        expect(await response.json()).toMatchObject({ result: { structuredContent: { items: [] } } })
        expect(listForms).toHaveBeenCalledWith({ page: 2 }, 'third-party-token')
    })

    it('lists the tool definitions without their implementation', async () => {
        const response = await POST(request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), context())

        expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'list_forms', description: 'List forms', inputSchema: { type: 'object' } }] } })
    })

    it('answers a parse error on a body that is not JSON', async () => {
        const response = await POST(new Request('https://rerun.test/api/mcp/managed/typeform', { method: 'POST', headers: { 'x-rerun-key': BOX_KEY }, body: '{oops' }), context())

        expect(await response.json()).toMatchObject({ error: { code: -32700 } })
    })
})
