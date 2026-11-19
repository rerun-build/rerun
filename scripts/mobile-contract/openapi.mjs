// The registry of the mobile API (`mobileApi` of @rerun/contracts) as an OpenAPI 3.0 document, the
// format oasdiff compares. Every schema is the input side of its zod schema: what `parse` accepts,
// which is what the app reads in a response and what the hub reads in a request.

const STREAM = { 'text/event-stream': { schema: { type: 'string' } } }
const BYTES = { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }

function jsonSchemaOf(z, schema, prefix, components) {
    const json = z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any', cycles: 'ref', reused: 'inline' })
    const defs = { ...(json.$defs ?? {}), ...(json.definitions ?? {}) }
    delete json.$defs
    delete json.definitions
    delete json.$schema
    const renamed = Object.fromEntries(Object.keys(defs).map(name => [name, `${prefix}_${name}`.replace(/[^\w.-]/g, '_')]))
    const rewrite = value => {
        if (Array.isArray(value)) return value.map(rewrite)
        if (!value || typeof value !== 'object') return value
        return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => {
                if (key === '$ref' && typeof inner === 'string') {
                    const name = inner.replace(/^#\/(\$defs|definitions)\//, '')
                    if (inner === '#') return [key, `#/components/schemas/${prefix}`]
                    return [key, renamed[name] ? `#/components/schemas/${renamed[name]}` : inner]
                }
                return [key, rewrite(inner)]
            })
        )
    }
    for (const [name, def] of Object.entries(defs)) {
        const { $schema: _schema, ...rest } = def
        components[renamed[name]] = rewrite(rest)
    }
    const root = rewrite(json)
    if (JSON.stringify(root).includes(`#/components/schemas/${prefix}"`)) components[prefix] = root
    return root
}

function queryParameters(z, query, prefix, components) {
    if (!query) return []
    const json = jsonSchemaOf(z, query, `${prefix}_query`, components)
    const required = new Set(json.required ?? [])
    return Object.entries(json.properties ?? {}).map(([name, schema]) => ({ name, in: 'query', required: required.has(name), schema }))
}

function contentOf(z, reply, prefix, components) {
    if (reply === 'none') return undefined
    if (reply === 'ui-message-stream') return STREAM
    if (reply === 'bytes') return BYTES
    return { 'application/json': { schema: jsonSchemaOf(z, reply, prefix, components) } }
}

function operationOf(z, name, endpoint, components) {
    const parameters = [...[...endpoint.path.matchAll(/\{(\w+)\}/g)].map(([, param]) => ({ name: param, in: 'path', required: true, schema: { type: 'string' } })), ...queryParameters(z, endpoint.query, name, components)]
    const success = { description: 'Success' }
    const content = contentOf(z, endpoint.response, `${name}_response`, components)
    if (content) success.content = content
    if (endpoint.headers?.length) success.headers = Object.fromEntries(endpoint.headers.map(header => [header, { required: true, schema: { type: 'string' } }]))
    const responses = { [String(endpoint.status)]: success }
    if (endpoint.emptyStatus) responses[String(endpoint.emptyStatus)] = { description: 'Nothing to answer' }
    for (const [status, schema] of Object.entries(endpoint.errors ?? {})) responses[status] = { description: 'A failure the app tells apart', content: { 'application/json': { schema: jsonSchemaOf(z, schema, `${name}_${status}`, components) } } }
    responses.default = { description: 'Any other failure', content: { 'application/json': { schema: { $ref: '#/components/schemas/HubError' } } } }
    const operation = { 'x-mobile-api': name, parameters, responses }
    if (endpoint.body === 'bytes') operation.requestBody = { required: true, content: BYTES }
    else if (endpoint.body) operation.requestBody = { required: true, content: { 'application/json': { schema: jsonSchemaOf(z, endpoint.body, `${name}_body`, components) } } }
    return operation
}

// `endpoints` is the registry, or the part of it a shipped build reads; `hubError` the body of a
// failure. Keys come out sorted, so the file only changes where the contract does.
export function openApiOf(z, endpoints, hubError, { title, version }) {
    const components = { HubError: jsonSchemaOf(z, hubError, 'HubError', {}) }
    const paths = {}
    for (const [name, endpoint] of Object.entries(endpoints).sort(([a], [b]) => a.localeCompare(b))) {
        paths[endpoint.path] ??= {}
        paths[endpoint.path][endpoint.method.toLowerCase()] = operationOf(z, name, endpoint, components)
    }
    return sorted({ openapi: '3.0.3', info: { title, version }, paths, components: { schemas: components } })
}

export function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, sorted(value[key])])
    )
}
