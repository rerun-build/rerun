// A value of an MCP server reads a variable of the coworker, or of its Vault item, as `${VAR}`. Written
// `${file:VAR}`, the server gets the path of a file the engine writes the variable into, for a server
// that takes its credential as a file (`GOOGLE_APPLICATION_CREDENTIALS`).
export const MCP_PLACEHOLDER = /\$\{(file:)?([A-Za-z_][A-Za-z0-9_]*)\}/g

const WHOLE_PLACEHOLDER = /^(?:Bearer )?\$\{(?:file:)?[A-Za-z_][A-Za-z0-9_]*\}$/

export function isMcpPlaceholder(value: string): boolean {
    return WHOLE_PLACEHOLDER.test(value)
}

export function mcpPlaceholderNames(value: string): string[] {
    return [...value.matchAll(MCP_PLACEHOLDER)].map(match => match[2])
}

export function renameMcpPlaceholders(value: string, rename: (name: string) => string | undefined): string {
    return value.replace(MCP_PLACEHOLDER, (whole, file: string | undefined, name: string) => {
        const next = rename(name)
        return next ? `\${${file ?? ''}${next}}` : whole
    })
}
