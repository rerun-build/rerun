const BRIDGE_PREFIX = /^(?:mcp__)?rerun__/

export function stripBridgePrefix(name: string): string {
    return name.replace(BRIDGE_PREFIX, '')
}

type ToolPartLike = { type: string; toolName?: string; toolCallId?: string; state?: string; input?: unknown; inputText?: string; output?: unknown; errorText?: string }

export function isToolPart<P extends { type: string }>(part: P): part is P & ToolPartLike {
    return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

export function toolNameOf(part: ToolPartLike): string {
    return stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))
}
