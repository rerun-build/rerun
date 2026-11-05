// What a process started for an agent may see of the engine's own environment: the user, the
// paths, the locale, the display and the network settings. Never the engine's configuration
// (RERUN_API_KEY, RERUN_PAIR_TOKEN, RERUN_HUB_BASE_URL, RERUN_DATA_DIR…), which a command the
// agent runs, an MCP server fetched from npm or its install scripts have no business reading.
export const INHERITED_ENV_VARS = ['HOME', 'LOGNAME', 'USER', 'SHELL', 'TERM', 'PATH', 'TMPDIR', 'TZ', 'LANG', 'LANGUAGE', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'COREPACK_ENABLE_DOWNLOAD_PROMPT'] as const

export const INHERITED_ENV_PREFIXES = ['LC_', 'XDG_'] as const

const inherited = (key: string): boolean => (INHERITED_ENV_VARS as readonly string[]).includes(key) || INHERITED_ENV_PREFIXES.some(prefix => key.startsWith(prefix))

export function inheritedEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(source)) if (value !== undefined && inherited(key)) env[key] = value
    return env
}

export function childProcessEnv(agentEnv: Record<string, string>, extra: Record<string, string> = {}): Record<string, string> {
    return { ...inheritedEnv(), ...agentEnv, ...extra }
}

// For a spawner that merges its `env` option over process.env itself: every engine variable absent
// from `env` is given an empty value, so the child sees the name at most, never the secret. An
// empty string rather than undefined because the Codex provider validates its settings as a record
// of strings before it ever spawns.
export function envOverlay(env: Record<string, string>): Record<string, string> {
    const overlay: Record<string, string> = {}
    for (const key of Object.keys(process.env)) if (!(key in env)) overlay[key] = ''
    return { ...overlay, ...env }
}
