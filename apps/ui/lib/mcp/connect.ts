// How to reach the account MCP server, as text a user can paste. No `server-only` here on
// purpose: lib/mcp/api-keys.ts carries one (it holds the hashing), and the dialog that shows
// these commands is a client component.

export const MCP_ACCOUNT_PATH = '/api/mcp/account'

// The placeholder a command carries when no key is in hand: the connect panel is readable
// before a key exists, and the user swaps this for their own.
export const KEY_PLACEHOLDER = 'rk_your_key'

const SERVER_NAME = 'rerun'

export function mcpAccountUrl(origin: string): string {
    return `${origin.replace(/\/$/, '')}${MCP_ACCOUNT_PATH}`
}

// For a client component with no server-resolved origin to hand down: the host being browsed is
// the one that is actually running, which a constant is not in dev or on a preview deploy.
export function browserMcpAccountUrl(): string {
    return typeof window === 'undefined' ? MCP_ACCOUNT_PATH : mcpAccountUrl(window.location.origin)
}

function authorizationHeader(key: string): string {
    return `Bearer ${key}`
}

export function claudeMcpAddCommand(url: string, key: string): string {
    return `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: ${authorizationHeader(key)}"`
}

// For a client that only speaks stdio.
export function mcpRemoteCommand(url: string, key: string): string {
    return `npx -y mcp-remote ${url} --header "Authorization: ${authorizationHeader(key)}"`
}

export type McpClientId = 'claude-code' | 'chatgpt' | 'cursor' | 'rerun' | 'other'

export type McpSnippetLabel = 'terminal' | 'shellProfile' | 'coworkerPanel' | 'serverUrl' | 'header' | 'stdioClients'

export type McpSnippetHint = 'codexCliOnly' | 'coworkerReach'

// `label` is a key of the `dialogs.mcpConnect.labels` messages, or a file path shown as it is.
// `block` marks a snippet that is a config to paste rather than a command to run, so it renders
// multi-line instead of on a single scrollable row.
export type McpSnippet = { label: McpSnippetLabel | { file: string }; value: string; block?: boolean; hint?: McpSnippetHint }

// `brand` is null where the picker names the client: the catch-all entry, which it translates, and the
// coworker, which goes by the name of the brand.
export const MCP_CLIENTS: { id: McpClientId; brand: string | null; docs: string }[] = [
    { id: 'claude-code', brand: 'Claude Code', docs: '/api/connect#claude-code' },
    { id: 'chatgpt', brand: 'ChatGPT', docs: '/api/connect#codex' },
    { id: 'cursor', brand: 'Cursor', docs: '/api/connect#cursor' },
    { id: 'rerun', brand: null, docs: '/api/connect#a-rerun-coworker' },
    { id: 'other', brand: null, docs: '/api/connect#any-other-client' },
]

export function mcpClientDocs(client: McpClientId): string {
    return MCP_CLIENTS.find(entry => entry.id === client)?.docs ?? '/api/connect'
}

// Codex never takes the key inline: it reads it from the environment each time it starts the
// server, so connecting takes an exported variable next to the `mcp add`.
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
            return [{ label: 'terminal', value: claudeMcpAddCommand(url, key) }]
        case 'chatgpt':
            return [
                { label: 'shellProfile', value: `export ${CODEX_KEY_ENV}="${key}"` },
                {
                    label: 'terminal',
                    value: `codex mcp add ${SERVER_NAME} --url ${url} --bearer-token-env-var ${CODEX_KEY_ENV}`,
                    hint: 'codexCliOnly',
                },
            ]
        case 'cursor':
            return [{ label: { file: '~/.cursor/mcp.json' }, value: cursorConfig(url, key), block: true }]
        case 'rerun':
            return [
                {
                    label: 'coworkerPanel',
                    value: rerunAgentConfig(url, key),
                    block: true,
                    hint: 'coworkerReach',
                },
            ]
        case 'other':
            return [
                { label: 'serverUrl', value: url },
                { label: 'header', value: `Authorization: ${authorizationHeader(key)}` },
                { label: 'stdioClients', value: mcpRemoteCommand(url, key) },
            ]
    }
}
