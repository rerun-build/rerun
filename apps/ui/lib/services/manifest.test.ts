import { composioTarget, defaultMethod, predictInstall, serviceManifestSchema, takesSeveralAccounts } from '@/lib/services/manifest'
import { describe, expect, it } from 'vitest'

const linkedinManifest = {
    slug: 'linkedin',
    name: 'LinkedIn',
    category: 'marketing',
    authMethods: [
        {
            id: 'composio',
            label: 'Connect with LinkedIn',
            kind: 'composio',
            recommended: true,
            composio: { toolkit: 'linkedin', authConfigId: 'ac_test', allowedTools: ['LINKEDIN_GET_MY_INFO'] },
            mcpServers: [
                {
                    name: 'linkedin',
                    transport: 'http',
                    url: '${RERUN_HUB_BASE_URL}/api/mcp/composio/linkedin',
                    headers: { 'x-rerun-key': '${RERUN_API_KEY}', 'x-rerun-agent': '${agent.id}' },
                },
            ],
        },
    ],
}

describe('composio manifests', () => {
    it('parses a composio auth method', () => {
        const manifest = serviceManifestSchema.parse(linkedinManifest)
        const method = defaultMethod(manifest)
        expect(method.kind).toBe('composio')
        expect(method.composio).toEqual({ toolkit: 'linkedin', authConfigId: 'ac_test', allowedTools: ['LINKEDIN_GET_MY_INFO'] })
    })

    it('resolves the composio target from the method', () => {
        const manifest = serviceManifestSchema.parse(linkedinManifest)
        expect(composioTarget(defaultMethod(manifest))).toEqual({ toolkit: 'linkedin', serverName: 'linkedin' })
    })

    it('returns no target for a non-composio method', () => {
        const manifest = serviceManifestSchema.parse({ slug: 's', name: 'S', inputs: [{ key: 'API_KEY', label: 'API key', secret: true, required: true }] })
        expect(composioTarget(defaultMethod(manifest))).toBeNull()
    })

    it('predicts needs_auth for a composio install', () => {
        const manifest = serviceManifestSchema.parse(linkedinManifest)
        expect(predictInstall(manifest).outcome).toBe('needs_auth')
    })
})

describe('takesSeveralAccounts', () => {
    const apiKey = { key: 'API_KEY', label: 'Key', secret: true, required: true }

    it('lets a coworker hold several accounts of an app whose secrets reach its own servers, whatever an old manifest still says', () => {
        expect(takesSeveralAccounts(serviceManifestSchema.parse(linkedinManifest))).toBe(true)
        const getxapi = serviceManifestSchema.parse({ slug: 'getxapi', name: 'GetXAPI', multiInstance: false, inputs: [{ ...apiKey, key: 'GETXAPI_KEY' }], mcpServers: [{ name: 'getxapi', transport: 'stdio', command: 'npx', env: { GETXAPI_KEY: '${input.GETXAPI_KEY}' } }] })
        expect(takesSeveralAccounts(getxapi)).toBe(true)
        const basic = serviceManifestSchema.parse({ slug: 'b', name: 'B', inputs: [{ ...apiKey, key: 'USER' }, { ...apiKey, key: 'PASS' }], mcpServers: [{ name: 'b', transport: 'http', url: 'https://b.test/mcp', headers: { Authorization: 'Basic ${basic:input.USER:input.PASS}' } }] })
        expect(takesSeveralAccounts(basic)).toBe(true)
    })

    it('keeps a paid app to one account', () => {
        const paid = serviceManifestSchema.parse({ slug: 'whatsapp-pro', name: 'WhatsApp Pro', multiInstance: true, authMethods: [{ id: 'app', label: 'Pick a number', kind: 'app', app: { appSlug: 'whatsapp' }, mcpServers: [{ name: 'whatsapp_pro', transport: 'http', url: 'https://hub.test/api/mcp/apps/whatsapp' }] }] })
        expect(takesSeveralAccounts(paid)).toBe(false)
    })

    it('keeps to one account an app whose key the skill reads from the environment', () => {
        const fathom = serviceManifestSchema.parse({
            slug: 'fathom',
            name: 'Fathom',
            skills: [{ name: 'fathom-usage', description: '', body: 'curl -H "X-Api-Key: $FATHOM_API_KEY"' }],
            authMethods: [
                { id: 'oauth', kind: 'oauth', mcpServers: [{ name: 'fathom', transport: 'http', url: 'https://fathom.test/mcp', oauth: {} }] },
                { id: 'api-key', kind: 'key', inputs: [{ ...apiKey, key: 'FATHOM_API_KEY' }], envKeys: [{ key: 'FATHOM_API_KEY', fromInput: 'FATHOM_API_KEY' }] },
            ],
        })
        expect(takesSeveralAccounts(fathom)).toBe(false)
    })

    it('keeps to one account an app whose skill quotes a value of the account', () => {
        const unipile = serviceManifestSchema.parse({
            slug: 'unipile',
            name: 'Unipile',
            skills: [{ name: 'unipile-usage', description: '', body: 'Base URL: `https://${input.UNIPILE_DSN}/api/v1`' }],
            inputs: [{ ...apiKey, key: 'UNIPILE_API_KEY' }, { key: 'UNIPILE_DSN', label: 'DSN', required: true }],
            mcpServers: [{ name: 'unipile', transport: 'http', url: 'https://unipile.test/mcp', headers: { 'X-API-KEY': '${input.UNIPILE_API_KEY}' } }],
        })
        expect(takesSeveralAccounts(unipile)).toBe(false)
    })

    it('offers no second account of an app with nothing to connect', () => {
        const mdn = serviceManifestSchema.parse({ slug: 'mozilla', name: 'MDN', mcpServers: [{ name: 'mdn', transport: 'http', url: 'https://mdn.test/mcp' }] })
        expect(takesSeveralAccounts(mdn)).toBe(false)
    })
})
