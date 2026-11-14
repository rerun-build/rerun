import { describe, expect, it } from 'vitest'
import { toToolInputSchema } from './mcp-schema.js'

const SCAN_AD = {
    type: 'object',
    properties: {
        ad_identifier: { type: 'string', minLength: 1, maxLength: 500 },
        collation_id: { type: 'string', minLength: 1, maxLength: 200 },
    },
    oneOf: [{ required: ['ad_identifier'] }, { required: ['collation_id'] }],
    additionalProperties: false,
}

const UPDATE_BOARD = {
    type: 'object',
    properties: {
        board_id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
        name: { type: 'string' },
        description: { oneOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
        visibility: { type: 'string', enum: ['private', 'workspace', 'public'] },
    },
    required: ['board_id'],
    anyOf: [{ required: ['name'] }, { required: ['description'] }, { required: ['visibility'] }],
    additionalProperties: false,
}

describe('toToolInputSchema', () => {
    it('lifts a root oneOf of required lists into a sentence for the model', () => {
        const { schema, note } = toToolInputSchema(SCAN_AD)
        expect(schema).toEqual({ type: 'object', properties: SCAN_AD.properties, additionalProperties: false })
        expect(note).toBe('Provide exactly one of: ad_identifier, collation_id.')
    })

    it('lifts a root anyOf, keeping the root required list and the unions nested in a property', () => {
        const { schema, note } = toToolInputSchema(UPDATE_BOARD)
        expect(schema).toEqual({ type: 'object', properties: UPDATE_BOARD.properties, required: ['board_id'], additionalProperties: false })
        expect(note).toBe('Provide at least one of: name, description, visibility.')
    })

    it('merges the properties of the branches without raising their required lists', () => {
        const { schema, note } = toToolInputSchema({
            type: 'object',
            properties: { id: { type: 'string' } },
            anyOf: [{ properties: { id: { type: 'number' }, url: { type: 'string' } }, required: ['url'] }, 'not a schema'],
        })
        expect(schema).toEqual({ type: 'object', properties: { id: { type: 'string' }, url: { type: 'string' } } })
        expect(note).toBeNull()
    })

    it('raises the required lists of an allOf, which every argument set has to meet', () => {
        const { schema, note } = toToolInputSchema({
            allOf: [
                { properties: { a: { type: 'string' } }, required: ['a'] },
                { properties: { b: { type: 'string' } }, required: ['b', 7] },
            ],
        })
        expect(schema).toEqual({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] })
        expect(note).toBeNull()
    })

    it('drops a combinator that is not a list', () => {
        expect(toToolInputSchema({ type: 'object', oneOf: 'broken' })).toEqual({ schema: { type: 'object' }, note: null })
    })

    it('adds the object type a root schema leaves out', () => {
        expect(toToolInputSchema({ properties: { q: { type: 'string' } } }).schema).toEqual({ type: 'object', properties: { q: { type: 'string' } } })
    })

    it('gives a bare object schema to a tool with no schema or a malformed one', () => {
        for (const input of [undefined, null, 'string', ['object']]) expect(toToolInputSchema(input)).toEqual({ schema: { type: 'object' }, note: null })
    })

    it('hands a schema that is already valid back untouched', () => {
        const input = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
        const { schema, note } = toToolInputSchema(input)
        expect(schema).toBe(input)
        expect(note).toBeNull()
    })
})
