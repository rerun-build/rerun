const COPY_SUFFIX = ' copy'

export function copyOf(name: string, limit: number): string {
    const available = limit - COPY_SUFFIX.length
    const trimmed = name.trim()
    if (trimmed.length <= available) return `${trimmed}${COPY_SUFFIX}`

    const cut = trimmed.slice(0, available).trimEnd()
    const lastSpace = cut.lastIndexOf(' ')
    const base = lastSpace > available / 2 ? cut.slice(0, lastSpace) : cut
    return `${base}${COPY_SUFFIX}`
}

const AGENT_NAME_LIMIT = 60

export function duplicateAgentName(name: string): string {
    return copyOf(name, AGENT_NAME_LIMIT)
}
