import { readFileSync } from 'node:fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { openApiOf } from './openapi.mjs'
import { CURRENT, CURRENT_TITLE, json, loadContracts } from './paths.mjs'
import { endpointsWith, refOf } from './schemas-at.mjs'

let z
let contracts

beforeAll(async () => {
    ;({ z, contracts } = await loadContracts())
})

const operation = (document, method, path) => document.paths[path][method.toLowerCase()]

describe('the contract of the mobile API', () => {
    // A registry change that leaves current.json behind would reach the release unseen: the tests of
    // every pull request catch it first.
    it('is the file the registry generates', () => {
        expect(readFileSync(CURRENT, 'utf8')).toBe(json(openApiOf(z, contracts.mobileApi, contracts.hubErrorSchema, CURRENT_TITLE)))
    })

    it('describes every call of the registry once, under its method and path', () => {
        const document = openApiOf(z, contracts.mobileApi, contracts.hubErrorSchema, CURRENT_TITLE)
        const described = Object.entries(document.paths).flatMap(([path, operations]) => Object.entries(operations).map(([method, op]) => `${method.toUpperCase()} ${path} ${op['x-mobile-api']}`))
        const registered = Object.entries(contracts.mobileApi).map(([name, endpoint]) => `${endpoint.method} ${endpoint.path} ${name}`)
        expect(described.sort()).toEqual(registered.sort())
    })
})

describe('openApiOf', () => {
    const endpoints = () => ({
        rename: contracts.hubEndpoint({ method: 'PATCH', path: '/api/v1/agents/{id}', body: z.object({ name: z.string(), color: z.string().default('blue') }), response: 'none', errors: { 409: z.object({ error: z.string(), reason: z.string() }) } }),
        upload: contracts.hubEndpoint({ method: 'POST', path: '/api/files/stream', query: z.object({ name: z.string(), dir: z.string().optional() }), body: 'bytes', response: z.object({ path: z.string() }), status: 201 }),
        send: contracts.hubEndpoint({ method: 'POST', path: '/api/chat', body: z.object({ text: z.string() }), response: 'ui-message-stream', headers: ['X-Session-Id'] }),
        resume: contracts.hubEndpoint({ method: 'GET', path: '/api/chat/resume', response: 'ui-message-stream', emptyStatus: 204 }),
    })

    it('writes the success status, the failures the app tells apart, and a default failure', () => {
        const op = operation(openApiOf(z, endpoints(), contracts.hubErrorSchema, CURRENT_TITLE), 'PATCH', '/api/v1/agents/{id}')
        expect(Object.keys(op.responses).sort()).toEqual(['204', '409', 'default'])
        expect(op.responses['204'].content).toBeUndefined()
        expect(op.responses['409'].content['application/json'].schema.required).toEqual(['error', 'reason'])
        expect(op.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }])
    })

    // The hub reads a request with `parse`, the app reads a response with it: what parse accepts is the
    // contract, so a field with a default is not required of the sender.
    it('describes what parse accepts', () => {
        const op = operation(openApiOf(z, endpoints(), contracts.hubErrorSchema, CURRENT_TITLE), 'PATCH', '/api/v1/agents/{id}')
        expect(op.requestBody.content['application/json'].schema.required).toEqual(['name'])
    })

    it('describes raw bytes, the query, a stream and its headers, and an empty success', () => {
        const document = openApiOf(z, endpoints(), contracts.hubErrorSchema, CURRENT_TITLE)
        const upload = operation(document, 'POST', '/api/files/stream')
        expect(upload.requestBody.content['application/octet-stream'].schema).toEqual({ type: 'string', format: 'binary' })
        expect(upload.parameters.map(param => [param.name, param.required])).toEqual([
            ['name', true],
            ['dir', false],
        ])
        expect(Object.keys(upload.responses)).toContain('201')
        const send = operation(document, 'POST', '/api/chat')
        expect(send.responses['200'].content['text/event-stream']).toBeDefined()
        expect(send.responses['200'].headers['X-Session-Id'].required).toBe(true)
        expect(Object.keys(operation(document, 'GET', '/api/chat/resume').responses)).toEqual(expect.arrayContaining(['200', '204']))
    })
})

describe('the registry as a shipped build reads it', () => {
    it('finds a schema of the registry again by its export, through the array around it', () => {
        expect(refOf(contracts.mobileApi.listAgents.response, contracts)).toEqual({ name: 'boardAgentSchema', wrap: ['array'] })
        expect(refOf(contracts.mobileApi.getMe.response, contracts)).toEqual({ name: 'meSchema', wrap: [] })
    })

    it('reads each response with the schema of the same name at the build, and keeps what the build did not export', () => {
        const oldBoardAgent = z.object({ id: z.string(), name: z.string(), status: z.enum(['idle', 'working']) })
        const old = { ...contracts, boardAgentSchema: oldBoardAgent, meSchema: undefined }
        const endpoints = endpointsWith(contracts, old)
        const listAgents = openApiOf(z, { listAgents: endpoints.listAgents }, contracts.hubErrorSchema, CURRENT_TITLE)
        const items = operation(listAgents, 'GET', '/api/v1/agents').responses['200'].content['application/json'].schema.items
        expect(items.properties.status.enum).toEqual(['idle', 'working'])
        expect(endpoints.getMe.response).toBe(contracts.mobileApi.getMe.response)
    })
})
