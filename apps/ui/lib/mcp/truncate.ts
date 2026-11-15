export const MCP_FIELD_CHAR_LIMIT = 2_000

export const MCP_RESPONSE_CHAR_LIMIT = 200_000

export function truncateField(value: string | null, limit: number = MCP_FIELD_CHAR_LIMIT): string | null {
    if (value === null || value.length <= limit) return value
    return `${value.slice(0, limit)}… [truncated] ${value.length - limit} more chars elided to save context`
}

export function responseTooLarge(serialized: string, limit: number = MCP_RESPONSE_CHAR_LIMIT): boolean {
    return serialized.length > limit
}

export function tooLargeMessage(name: string, size: number, limit: number = MCP_RESPONSE_CHAR_LIMIT): string {
    return `${name} produced ${size} characters, over the ${limit} limit for one tool result. Narrow the request (fewer rows, a single item, or drop includeToolCalls) rather than retrying as is.`
}
