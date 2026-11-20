import { isRecord } from '@rerun/contracts'

// A Composio tool that takes a file wants one already in Composio's storage, `{ name, mimetype, s3key }`,
// marked `file_uploadable` in its schema. A coworker only has files on its box, so its tools ask for a
// path instead and the hub uploads the file on the way, as Composio's own SDK does.

export type ComposioFile = { name: string; mimetype: string; s3key: string }

const FILE_PATH_DESCRIPTION = 'Path of a file in your workspace (e.g. output/kit.pdf) or in the shared space (e.g. content/media-kit.pdf). It is sent privately, never made public.'

const VARIANT_KEYS = ['anyOf', 'oneOf', 'allOf'] as const

function filePathSchema(input: Record<string, unknown>): Record<string, unknown> {
    const description = [input.description, FILE_PATH_DESCRIPTION].filter(text => typeof text === 'string' && text).join(' ')
    return { ...(typeof input.title === 'string' ? { title: input.title } : {}), type: 'string', description }
}

export function withFilePaths(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(withFilePaths)
    if (!isRecord(schema)) return schema
    if (schema.file_uploadable) return filePathSchema(schema)
    const rewritten: Record<string, unknown> = { ...schema }
    if (isRecord(schema.properties)) rewritten.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, property]) => [name, withFilePaths(property)]))
    if ('items' in schema) rewritten.items = withFilePaths(schema.items)
    for (const key of VARIANT_KEYS) if (key in schema) rewritten[key] = withFilePaths(schema[key])
    return rewritten
}

function fits(variant: Record<string, unknown>, value: unknown): boolean {
    if (variant.file_uploadable) return typeof value === 'string'
    if (Array.isArray(value)) return variant.type === 'array' || 'items' in variant
    if (isRecord(value)) return variant.type === 'object' || 'properties' in variant
    return false
}

// Only a path written where the original schema takes a file is uploaded: anything else, a file
// Composio already holds included, goes through as it is. An empty path means no file, as in the SDK.
// Files go one after the other, so the hub never holds more than one of them at a time.
async function resolveValue(schema: unknown, value: unknown, upload: (path: string) => Promise<ComposioFile>): Promise<unknown> {
    if (!isRecord(schema)) return value
    if (schema.file_uploadable) {
        if (value === '') return undefined
        return typeof value === 'string' ? upload(value) : value
    }

    let resolved = value
    for (const key of VARIANT_KEYS) {
        const variants = Array.isArray(schema[key]) ? (schema[key] as unknown[]).filter(isRecord) : []
        if (key === 'allOf') {
            for (const variant of variants) resolved = await resolveValue(variant, resolved, upload)
        } else {
            const variant = variants.find(v => fits(v, resolved))
            if (variant) resolved = await resolveValue(variant, resolved, upload)
        }
    }

    if (Array.isArray(resolved) && isRecord(schema.items)) {
        const items: unknown[] = []
        for (const item of resolved) items.push(await resolveValue(schema.items, item, upload))
        return items
    }
    if (isRecord(resolved) && isRecord(schema.properties)) {
        const entries: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(resolved)) entries[key] = await resolveValue(schema.properties[key], item, upload)
        return entries
    }
    return resolved
}

export async function resolveFileArgs(schema: unknown, args: Record<string, unknown>, upload: (path: string) => Promise<ComposioFile>): Promise<Record<string, unknown>> {
    const resolved = await resolveValue(schema, args, upload)
    return isRecord(resolved) ? resolved : args
}

export type BoxFileLocation = { base: string; path: string }

// The engine tells a coworker the absolute paths of its workspace and of the shared space, so either
// form comes back. A relative path is what its fs_ tools take as much as its shared_ tools, so it is
// looked for in its workspace first, then in the shared space. The engine confines the path to the
// root it is read from.
export function boxFileLocations(path: string, engineAgentId: string): BoxFileLocation[] {
    const ownFiles = `/agents/${engineAgentId}/files`
    const sharedFiles = '/shared/files'
    if (!path.startsWith('/')) return [{ base: ownFiles, path }, { base: sharedFiles, path }]
    const workspaceMarker = `/agents/${engineAgentId}/workspace/`
    const inWorkspace = path.indexOf(workspaceMarker)
    if (inWorkspace >= 0) return [{ base: ownFiles, path: path.slice(inWorkspace + workspaceMarker.length) }]
    if (path.includes('/agents/')) return []
    const inShared = path.indexOf('/shared/')
    if (inShared >= 0) return [{ base: sharedFiles, path: path.slice(inShared + '/shared/'.length) }]
    return []
}
