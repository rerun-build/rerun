import { InvalidToolInputError, NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from 'ai'
import { canonicalBridgeName } from '../tools/builtin/hitl.js'

// Many OpenAI-compatible models serialise an omitted optional field as an explicit `null`, which
// every `.optional()` schema rejects. Dropping those keys turns the rejected call into the call the
// model meant to make, without a repair round-trip to the model.
function stripNullProperties(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripNullProperties)
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== null)
                .map(([key, item]) => [key, stripNullProperties(item)]),
        )
    }
    return value
}

export function repairNullToolInput(inputText: string): string | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(inputText)
    } catch {
        return null
    }
    const repaired = JSON.stringify(stripNullProperties(parsed))
    return repaired === JSON.stringify(parsed) ? null : repaired
}

const CLI_MCP_TOOL_NAME = /^mcp__(.+?)__(.+)$/

// A conversation that ran on Claude or Codex holds their names for the same tools
// (`mcp__rerun__schedule_list`, `mcp__github__pull_request_read`), and a model taking over the
// conversation in Rerun's own loop sometimes copies them.
export function loopToolNameFor(toolName: string, tools: Record<string, unknown>): string | null {
    const bridged = canonicalBridgeName(toolName)
    const connector = CLI_MCP_TOOL_NAME.exec(toolName)
    const candidates = [bridged, connector ? `${connector[1]}_${connector[2]}` : null]
    return candidates.find(name => name && name !== toolName && name in tools) ?? null
}

export const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({ toolCall, tools, error }) => {
    if (NoSuchToolError.isInstance(error)) {
        const toolName = loopToolNameFor(toolCall.toolName, tools)
        return toolName ? { ...toolCall, toolName, input: repairNullToolInput(toolCall.input) ?? toolCall.input } : null
    }
    if (!InvalidToolInputError.isInstance(error)) return null
    const input = repairNullToolInput(toolCall.input)
    return input === null ? null : { ...toolCall, input }
}
