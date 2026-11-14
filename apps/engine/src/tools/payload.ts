import { asSchema, type ToolSet } from 'ai'

export function toolPayloadChars(tools: ToolSet): number {
    let total = 0
    for (const [name, t] of Object.entries(tools)) {
        total += JSON.stringify({ name, description: t.description, parameters: asSchema(t.inputSchema).jsonSchema }).length
    }
    return total
}
