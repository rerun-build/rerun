export const MCP_ACCOUNT_PATH = '/api/mcp/account'

export const KEY_PLACEHOLDER = 'rk_your_key'

const SERVER_NAME = 'rerun'

export function mcpAccountUrl(origin: string): string {
    return `${origin.replace(/\/$/, '')}${MCP_ACCOUNT_PATH}`
}

export function browserMcpAccountUrl(): string {
    return typeof window === 'undefined' ? MCP_ACCOUNT_PATH : mcpAccountUrl(window.location.origin)
}

function authorizationHeader(key: string): string {
    return `Bearer ${key}`
}

export function claudeMcpAddCommand(url: string, key: string): string {
    return `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: ${authorizationHeader(key)}"`
}

export function mcpRemoteCommand(url: string, key: string): string {
    return `npx -y mcp-remote ${url} --header "Authorization: ${authorizationHeader(key)}"`
}

export type McpClientId = 'claude-code' | 'chatgpt' | 'cursor' | 'rerun' | 'other'

export type McpSnippet = { label: string; value: string; block?: boolean; hint?: string }

export const MCP_CLIENTS: { id: McpClientId; label: string; docs: string }[] = [
    { id: 'claude-code', label: 'Claude Code', docs: '/api/connect#claude-code' },
    { id: 'chatgpt', label: 'ChatGPT', docs: '/api/connect#codex' },
    { id: 'cursor', label: 'Cursor', docs: '/api/connect#cursor' },
    { id: 'rerun', label: 'Moldwright', docs: '/api/connect#a-rerun-agent' },
    { id: 'other', label: 'Other', docs: '/api/connect#any-other-client' },
]

export function mcpClientDocs(client: McpClientId): string {
    return MCP_CLIENTS.find(entry => entry.id === client)?.docs ?? '/api/connect'
}

const CODEX_KEY_ENV = 'RERUN_MCP_KEY'

function cursorConfig(url: string, key: string): string {
    return JSON.stringify({ mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: authorizationHeader(key) } } } }, null, 2)
}

function rerunAgentConfig(url: string, key: string): string {
    return JSON.stringify({ name: SERVER_NAME, transport: 'http', url, headers: { Authorization: authorizationHeader(key) } }, null, 2)
}

export function mcpClientSnippets(client: McpClientId, url: string, key: string): McpSnippet[] {
    switch (client) {
        case 'claude-code':
            return [{ label: 'Terminal', value: claudeMcpAddCommand(url, key) }]
        case 'chatgpt':
            return [
                { label: 'Shell profile', value: `export ${CODEX_KEY_ENV}="${key}"` },
                {
                    label: 'Terminal',
                    value: `codex mcp add ${SERVER_NAME} --url ${url} --bearer-token-env-var ${CODEX_KEY_ENV}`,
                    hint: 'Codex CLI. The ChatGPT app only takes OAuth connections, so a key gets you nowhere there.',
                },
            ]
        case 'cursor':
            return [{ label: '~/.cursor/mcp.json', value: cursorConfig(url, key), block: true }]
        case 'rerun':
            return [
                {
                    label: 'Coworker panel, MCP, New',
                    value: rerunAgentConfig(url, key),
                    block: true,
                    hint: 'Gives one of your coworkers the same reach over this workspace as an outside client.',
                },
            ]
        case 'other':
            return [
                { label: 'Server URL', value: url },
                { label: 'Header', value: `Authorization: ${authorizationHeader(key)}` },
                { label: 'Clients that only speak stdio', value: mcpRemoteCommand(url, key) },
            ]
    }
}
