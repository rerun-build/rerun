import { isRecord } from '@rerun/contracts'

type JsonObject = Record<string, unknown>

const ROOT_COMBINATORS = ['oneOf', 'anyOf', 'allOf'] as const

const requiredOf = (branch: JsonObject): string[] => (Array.isArray(branch.required) ? branch.required.filter((name): name is string => typeof name === 'string') : [])

// A branch that only says which arguments must be present, the way MCP servers write "exactly one of
// these" (`oneOf: [{ required: ['a'] }, { required: ['b'] }]`).
const onlyRequires = (branch: JsonObject): boolean => Object.keys(branch).every(key => key === 'required') && requiredOf(branch).length > 0

function constraintNote(kind: (typeof ROOT_COMBINATORS)[number], branches: JsonObject[]): string | null {
    if (kind === 'allOf' || branches.length === 0 || !branches.every(onlyRequires)) return null
    const names = [...new Set(branches.flatMap(requiredOf))].join(', ')
    return kind === 'oneOf' ? `Provide exactly one of: ${names}.` : `Provide at least one of: ${names}.`
}

// Anthropic refuses the whole request when one tool's input_schema has `oneOf`, `anyOf` or `allOf` at
// its root, and an MCP server is free to send one: a single such tool failed every run of the agent
// carrying it. The root union is lifted into plain properties, and the rule it carried goes to the
// model as a sentence. Nothing is let through that the server would have taken: it still validates the
// arguments it receives, and its refusal reaches the agent as the tool's result.
export function toToolInputSchema(input: unknown): { schema: JsonObject; note: string | null } {
    if (!isRecord(input)) return { schema: { type: 'object' }, note: null }
    if (input.type === 'object' && ROOT_COMBINATORS.every(kind => !(kind in input))) return { schema: input, note: null }

    const schema: JsonObject = { ...input, type: 'object' }
    const properties: JsonObject = isRecord(input.properties) ? { ...input.properties } : {}
    const required = new Set(requiredOf(input))
    const notes: string[] = []
    for (const kind of ROOT_COMBINATORS) {
        if (!(kind in schema)) continue
        const branches = Array.isArray(schema[kind]) ? (schema[kind] as unknown[]).filter(isRecord) : []
        delete schema[kind]
        for (const branch of branches) {
            if (isRecord(branch.properties)) for (const [name, property] of Object.entries(branch.properties)) if (!(name in properties)) properties[name] = property
            if (kind === 'allOf') for (const name of requiredOf(branch)) required.add(name)
        }
        const note = constraintNote(kind, branches)
        if (note) notes.push(note)
    }
    if (Object.keys(properties).length > 0) schema.properties = properties
    if (required.size > 0) schema.required = [...required]
    return { schema, note: notes.length > 0 ? notes.join(' ') : null }
}
