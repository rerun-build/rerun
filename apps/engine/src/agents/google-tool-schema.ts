import type { LanguageModelMiddleware } from 'ai'
import { constraintNote } from '../tools/mcp-schema.js'

type Schema = Record<string, unknown>

const isUsableEnumValue = (value: unknown): value is string => typeof value === 'string' && value !== ''

function isSchema(value: unknown): value is Schema {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredOnlyUnionNote(key: string, value: unknown): string | null {
    if ((key !== 'anyOf' && key !== 'oneOf') || !Array.isArray(value) || !value.every(isSchema)) return null
    return constraintNote(key, value)
}

// Gemini turns down the whole request over a single schema it does not take, and a whole run goes
// with it. Two shapes have cost every run on a Google key so far:
// - an enum value that is not a non-empty string: Buffer's `thumbnailUrl` (`anyOf: [uri, const ""]`) or
//   our own `z.literal(true)`;
// - a union whose branches only say which properties must be present, which Gemini only takes on a
//   branch of type OBJECT defining them: the mail server's `signature` (`anyOf: [{ required: ['text'] },
//   { required: ['html'] }]`). The rule goes to the model as a sentence in the description instead.
// Only the copy sent to Google loses the constraint: the AI SDK still validates the model's arguments
// against the tool's own schema, and the MCP server its own.
export function geminiCompatibleSchema(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(geminiCompatibleSchema)
    if (!isSchema(schema)) return schema

    const result: Schema = {}
    const notes: string[] = []
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'const' && !isUsableEnumValue(value)) continue
        if (key === 'enum' && Array.isArray(value)) {
            const kept = value.filter(isUsableEnumValue)
            if (kept.length) result.enum = kept
            continue
        }
        const note = requiredOnlyUnionNote(key, value)
        if (note) {
            notes.push(note)
            continue
        }
        result[key] = key === 'properties' || key === '$defs' || key === 'definitions' ? mapValues(value) : geminiCompatibleSchema(value)
    }
    if (notes.length) result.description = [result.description, ...notes].filter(Boolean).join('\n\n')
    return result
}

function mapValues(value: unknown): unknown {
    if (!isSchema(value)) return value
    return Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, geminiCompatibleSchema(schema)]))
}

export const googleToolSchemaMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
        if (!params.tools?.length) return params
        return {
            ...params,
            tools: params.tools.map(tool => (tool.type === 'function' ? { ...tool, inputSchema: geminiCompatibleSchema(tool.inputSchema) as typeof tool.inputSchema } : tool)),
        }
    },
}
