import { isRecord, MCP_SERVER_NAME_RE } from '@rerun/contracts'

// Reads the JSON people copy from an MCP server's README (Claude Desktop, Cursor, Claude Code,
// VS Code, Windsurf) and returns the servers it holds, ready to fill the MCP server forms.

export type McpTransport = 'stdio' | 'sse' | 'http'

export type ParsedMcpServer = {
    name: string
    nameProposed: boolean
    transport: McpTransport
    transportGuessed: boolean
    command?: string
    args: string[]
    url?: string
    env: Record<string, string>
    headers: Record<string, string>
}

// `scope` is `named` when the error is about one server of the paste, so the message can name it.
type ServerScope = { scope: 'named' | 'bare'; server: string }

export type McpConfigError =
    | { code: 'invalidJson'; detail: string }
    | { code: 'notAnObject' }
    | { code: 'containerNotObject' }
    | { code: 'noServer' }
    | { code: 'emptyContainer' }
    | ({ code: 'serverNotObject' } & ServerScope)
    | ({ code: 'invalidName' } & ServerScope)
    | ({ code: 'unknownField'; fields: string } & ServerScope)
    | ({ code: 'notText'; field: string } & ServerScope)
    | ({ code: 'commandAndUrl' } & ServerScope)
    | ({ code: 'argsNotList' } & ServerScope)
    | ({ code: 'unknownTransport'; transport: string } & ServerScope)
    | ({ code: 'needsCommand' } & ServerScope)
    | ({ code: 'needsUrl'; transport: string } & ServerScope)
    | ({ code: 'notMap'; field: string } & ServerScope)
    | ({ code: 'unresolvedRef'; field: string; ref: string } & ServerScope)
    | ({ code: 'multiline'; field: string } & ServerScope)

export type McpConfigParse = { ok: true; servers: ParsedMcpServer[] } | { ok: false; error: McpConfigError }

const KNOWN_FIELDS = new Set(['command', 'args', 'env', 'url', 'serverUrl', 'headers', 'type', 'transport'])
// Fields other clients write that mean nothing to a coworker: dropped, never an error.
const IGNORED_FIELDS = new Set(['cwd', 'disabled', 'autoApprove', 'alwaysAllow', 'timeout', 'description', 'envFile', 'trust', 'includeTools', 'excludeTools'])

const looksLikeServer = (value: unknown) => isRecord(value) && ('command' in value || 'url' in value || 'serverUrl' in value)

// Trailing commas and comments are what a README snippet or a VS Code settings file carries most.
function relaxedJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch (strictError) {
        const relaxed = text
            .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, quoted: string | undefined) => quoted ?? '')
            .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (_, quoted: string | undefined, closing: string | undefined) => quoted ?? closing ?? '')
        try {
            return JSON.parse(relaxed)
        } catch {
            throw strictError
        }
    }
}

type TransportRead = { transport: McpTransport; guessed: boolean } | { unknown: string }

function transportOf(entry: Record<string, unknown>, url: string | undefined): TransportRead {
    const declared = entry.type ?? entry.transport
    if (typeof declared === 'string') {
        const value = declared.toLowerCase().replace(/[^a-z]/g, '')
        if (value === 'stdio') return { transport: 'stdio', guessed: false }
        if (value === 'sse') return { transport: 'sse', guessed: false }
        if (value === 'http' || value === 'streamablehttp') return { transport: 'http', guessed: false }
        return { unknown: declared }
    }
    if (!url) return { transport: 'stdio', guessed: false }
    return { transport: /\/sse\/?(\?|$)/i.test(url) ? 'sse' : 'http', guessed: true }
}

function stringMap(value: unknown): Record<string, string> | null {
    if (value === undefined) return {}
    if (!isRecord(value)) return null
    const out: Record<string, string> = {}
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return null
        out[key] = String(item)
    }
    return out
}

const RUNNER_SUBCOMMANDS = new Set(['run', 'exec', 'x', 'dlx', 'tool'])
const CONTAINER_IMAGE = /^[a-z0-9][a-z0-9.-]*(:\d+)?(\/[a-z0-9._-]+)+(:[\w.-]+)?(@sha256:[a-f0-9]+)?$/i
const IP_ADDRESS = /^(\[|[\d.]+$)/

// What a command starts: the container's image, else the package or the script it runs.
export function packageOf(command: string | undefined, args: string[]): string | undefined {
    const image = /(^|\/)(docker|podman)$/.test(command ?? '') ? args.find(arg => CONTAINER_IMAGE.test(arg)) : undefined
    return image?.replace(/(@sha256:[a-f0-9]+|:[\w.-]+)+$/i, '') ?? args.find(arg => !arg.startsWith('-') && !RUNNER_SUBCOMMANDS.has(arg)) ?? command
}

function proposeName(source: string | undefined, url: string | undefined, index: number): string {
    let origin = source
    if (url) {
        try {
            const { hostname } = new URL(url)
            origin = IP_ADDRESS.test(hostname) ? undefined : hostname.replace(/^(www|mcp|api)\./, '').split('.')[0]
        } catch {
            origin = undefined
        }
    }
    const slug = (origin ?? '')
        .replace(/^@[^/]+\//, '')
        .replace(/@[^/]*$/, '')
        .replace(/^.*\//, '')
        .replace(/\.(m?js|ts|py)$/, '')
        .replace(/^(mcp-)?server-|-mcp(-server)?$/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .slice(0, 64)
        .replace(/^-+|-+$/g, '')
    return slug || `server-${index + 1}`
}

// `${input:token}`, `${env:TOKEN}` and `${TOKEN:-default}` are resolved by the client the config was
// written for. Rerun only reads `${TOKEN}` and `${file:TOKEN}`, so the rest would be stored as the
// secret itself.
const FOREIGN_REF = /\$\{(?!file:[A-Za-z_][A-Za-z0-9_]*\})[A-Za-z_][A-Za-z0-9_]*:[^}]*\}/

type ValueProblem = { code: 'unresolvedRef'; field: string; ref: string } | { code: 'multiline'; field: string }

// The engine keeps one line per variable, and the form one argument per line.
function valueProblem(values: [field: string, value: string][]): ValueProblem | null {
    for (const [field, value] of values) {
        const ref = FOREIGN_REF.exec(value)?.[0]
        if (ref) return { code: 'unresolvedRef', field, ref }
        if (/[\r\n]/.test(value.trim())) return { code: 'multiline', field }
    }
    return null
}

function readServer(rawName: string | null, entry: Record<string, unknown>, index: number): ParsedMcpServer | McpConfigError {
    const scope: ServerScope = rawName === null ? { scope: 'bare', server: '' } : { scope: 'named', server: rawName }
    const unknown = Object.keys(entry).filter(key => !KNOWN_FIELDS.has(key) && !IGNORED_FIELDS.has(key))
    if (unknown.length > 0) return { code: 'unknownField', fields: unknown.map(key => `"${key}"`).join(', '), ...scope }

    const url = entry.url ?? entry.serverUrl
    if (url !== undefined && typeof url !== 'string') return { code: 'notText', field: 'url', ...scope }
    if (entry.command !== undefined && typeof entry.command !== 'string') return { code: 'notText', field: 'command', ...scope }
    if (entry.command && url) return { code: 'commandAndUrl', ...scope }
    const rawArgs = entry.args
    if (rawArgs !== undefined && (!Array.isArray(rawArgs) || rawArgs.some(arg => typeof arg !== 'string' && typeof arg !== 'number'))) return { code: 'argsNotList', ...scope }

    const transport = transportOf(entry, url)
    if ('unknown' in transport) return { code: 'unknownTransport', transport: transport.unknown, ...scope }
    if (transport.transport === 'stdio' && !entry.command) return { code: 'needsCommand', ...scope }
    if (transport.transport !== 'stdio' && !url) return { code: 'needsUrl', transport: transport.transport, ...scope }

    const env = stringMap(entry.env)
    if (!env) return { code: 'notMap', field: 'env', ...scope }
    const headers = stringMap(entry.headers)
    if (!headers) return { code: 'notMap', field: 'headers', ...scope }

    // A command pasted as one line ("npx -y @scope/server") is split the way the shell would.
    const words = typeof entry.command === 'string' ? (rawArgs ? [entry.command.trim()] : entry.command.trim().split(/\s+/)) : []
    const [command, ...inlineArgs] = words
    const args = Array.isArray(rawArgs) ? rawArgs.map(String) : inlineArgs

    const problem = valueProblem([['url', url ?? ''], ...args.map((arg): [string, string] => ['args', arg]), ...Object.entries(env), ...Object.entries(headers)])
    if (problem) return { ...problem, ...scope }

    return {
        name: rawName ?? proposeName(packageOf(command, args), url, index),
        nameProposed: rawName === null,
        transport: transport.transport,
        transportGuessed: transport.guessed,
        command,
        args,
        url,
        env,
        headers,
    }
}

export function parseMcpConfig(text: string): McpConfigParse {
    if (!text.trim()) return { ok: true, servers: [] }

    let root: unknown
    try {
        root = relaxedJson(text)
    } catch (error) {
        return { ok: false, error: { code: 'invalidJson', detail: (error as Error).message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+/, '') } }
    }
    if (!isRecord(root)) return { ok: false, error: { code: 'notAnObject' } }

    const vsCode = isRecord(root.mcp) ? root.mcp.servers : undefined
    const container = root.mcpServers ?? root.servers ?? vsCode
    let entries: [string | null, unknown][]
    if (container !== undefined) {
        if (!isRecord(container)) return { ok: false, error: { code: 'containerNotObject' } }
        entries = Object.entries(container)
    } else if (looksLikeServer(root)) {
        entries = [[null, root]]
    } else if (Object.values(root).length > 0 && Object.values(root).every(looksLikeServer)) {
        entries = Object.entries(root)
    } else {
        return { ok: false, error: { code: 'noServer' } }
    }
    if (entries.length === 0) return { ok: false, error: { code: 'emptyContainer' } }

    const servers: ParsedMcpServer[] = []
    for (const [index, [name, entry]] of entries.entries()) {
        const scope: ServerScope = name === null ? { scope: 'bare', server: '' } : { scope: 'named', server: name }
        if (!isRecord(entry)) return { ok: false, error: { code: 'serverNotObject', ...scope } }
        if (name !== null && !MCP_SERVER_NAME_RE.test(name)) return { ok: false, error: { code: 'invalidName', ...scope } }
        const server = readServer(name, entry, index)
        if ('code' in server) return { ok: false, error: server }
        servers.push(server)
    }
    return { ok: true, servers }
}
