import { describe, expect, it } from 'vitest'
import { isMcpPlaceholder, mcpPlaceholderNames, redactVaultValue, renameMcpPlaceholders, type McpServer } from '@rerun/contracts'
import { resolveServerSecrets } from './mcp-resolve.js'

function server(partial: Partial<McpServer> & { name: string }): McpServer {
    return { args: [], env: {}, headers: {}, ...partial }
}

describe('resolveServerSecrets', () => {
    it('resolves placeholders in env, headers, url, command and args from the agent env', () => {
        const s = server({
            name: 'api',
            command: 'run-${BIN}',
            args: ['--token', '${TOKEN}'],
            url: 'https://${HOST}/mcp',
            env: { API_KEY: '${TOKEN}' },
            headers: { Authorization: 'Bearer ${TOKEN}' },
        })
        const resolved = resolveServerSecrets(s, { BIN: 'server', TOKEN: 'sk_live', HOST: 'example.com' })
        expect(resolved.command).toBe('run-server')
        expect(resolved.args).toEqual(['--token', 'sk_live'])
        expect(resolved.url).toBe('https://example.com/mcp')
        expect(resolved.env).toEqual({ API_KEY: 'sk_live' })
        expect(resolved.headers).toEqual({ Authorization: 'Bearer sk_live' })
    })

    it('leaves a ${file:VAR} to the step that writes its file', () => {
        const resolved = resolveServerSecrets(server({ name: 'x', env: { CREDS: '${file:SA}', KEY: '${SA}' } }), { SA: '{"k":1}' })
        expect(resolved.env).toEqual({ CREDS: '${file:SA}', KEY: '{"k":1}' })
    })

    it('falls back to the engine env for the hub base URL only', () => {
        process.env.RERUN_HUB_BASE_URL = 'https://hub.example'
        const resolved = resolveServerSecrets(server({ name: 'x', url: '${RERUN_HUB_BASE_URL}/api/mcp/composio/gmail' }), {})
        expect(resolved.url).toBe('https://hub.example/api/mcp/composio/gmail')
        delete process.env.RERUN_HUB_BASE_URL
    })

    it('never hands the engine key, nor any other engine variable, to a server config', () => {
        process.env.RERUN_API_KEY = 'engine-secret'
        process.env.RERUN_TEST_FALLBACK = 'from-process'
        const resolved = resolveServerSecrets(
            server({ name: 'x', url: 'https://collector.example/mcp?k=${RERUN_API_KEY}', headers: { Authorization: 'Bearer ${RERUN_API_KEY}' }, env: { K: '${RERUN_TEST_FALLBACK}' } }),
            {},
        )
        expect(resolved.url).toBe('https://collector.example/mcp?k=')
        expect(resolved.headers.Authorization).toBe('Bearer ')
        expect(resolved.env.K).toBe('')
        delete process.env.RERUN_API_KEY
        delete process.env.RERUN_TEST_FALLBACK
    })

    it('still resolves the engine key when the agent env names it itself', () => {
        const resolved = resolveServerSecrets(server({ name: 'x', headers: { 'x-rerun-key': '${RERUN_API_KEY}' } }), { RERUN_API_KEY: 'from-agent' })
        expect(resolved.headers['x-rerun-key']).toBe('from-agent')
    })

    it('resolves an unknown placeholder to an empty string', () => {
        const resolved = resolveServerSecrets(server({ name: 'x', headers: { Authorization: 'Bearer ${MISSING}' } }), {})
        expect(resolved.headers.Authorization).toBe('Bearer ')
    })

    it('does not resolve keys, only values', () => {
        const resolved = resolveServerSecrets(server({ name: 'x', env: { '${NOT_A_VAR}': 'v' } }), { NOT_A_VAR: 'nope' })
        expect(Object.keys(resolved.env)).toEqual(['${NOT_A_VAR}'])
    })

    it('leaves strings without placeholders untouched (OAuth bearer passes through)', () => {
        const resolved = resolveServerSecrets(server({ name: 'x', headers: { Authorization: 'Bearer real-token' } }), { TOKEN: 'other' })
        expect(resolved.headers.Authorization).toBe('Bearer real-token')
    })

    it('is idempotent on an already-resolved server', () => {
        const once = resolveServerSecrets(server({ name: 'x', env: { K: '${TOKEN}' } }), { TOKEN: 'v' })
        const twice = resolveServerSecrets(once, { TOKEN: 'v' })
        expect(twice).toEqual(once)
    })
})

describe('the placeholders of a server value', () => {
    it('names the variables of both forms and renames them keeping the form', () => {
        expect(mcpPlaceholderNames('${file:SA} and Bearer ${TOKEN}')).toEqual(['SA', 'TOKEN'])
        expect(renameMcpPlaceholders('${file:SA}|${SA}|${OTHER}', name => (name === 'SA' ? 'SA_2' : undefined))).toBe('${file:SA_2}|${SA_2}|${OTHER}')
    })

    it('shows a file placeholder of a Vault item as it is, like a plain one', () => {
        expect(isMcpPlaceholder('${file:SA}')).toBe(true)
        expect(redactVaultValue('${file:SA}')).toBe('${file:SA}')
        expect(redactVaultValue('{"private_key":"x"}')).not.toContain('private_key')
    })
})
