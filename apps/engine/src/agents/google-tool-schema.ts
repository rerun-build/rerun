import type { LanguageModelMiddleware } from 'ai'

type Schema = Record<string, unknown>

const isUsableEnumValue = (value: unknown): value is string => typeof value === 'string' && value !== ''

function isSchema(value: unknown): value is Schema {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function geminiCompatibleSchema(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(geminiCompatibleSchema)
    if (!isSchema(schema)) return schema

    const result: Schema = {}
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'const' && !isUsableEnumValue(value)) continue
        if (key === 'enum' && Array.isArray(value)) {
            const kept = value.filter(isUsableEnumValue)
            if (kept.length) result.enum = kept
            continue
        }
        result[key] = key === 'properties' || key === '$defs' || key === 'definitions' ? mapValues(value) : geminiCompatibleSchema(value)
    }
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
