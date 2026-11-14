import { describe, expect, it } from 'vitest'
import { asSchema } from 'ai'
import { z } from 'zod'
import { geminiCompatibleSchema, googleToolSchemaMiddleware } from './google-tool-schema.js'

const BUFFER_THUMBNAIL = { anyOf: [{ type: 'string', format: 'uri' }, { type: 'string', const: '' }] }

describe('geminiCompatibleSchema', () => {
    it('drops an empty-string const, deep in a union', () => {
        const schema = { type: 'object', properties: { assets: { type: 'array', items: { type: 'object', properties: { thumbnailUrl: BUFFER_THUMBNAIL } } } } }
        expect(geminiCompatibleSchema(schema)).toEqual({ type: 'object', properties: { assets: { type: 'array', items: { type: 'object', properties: { thumbnailUrl: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'string' }] } } } } } })
    })

    it('drops a literal that is not a string', async () => {
        const schema = await asSchema(z.object({ slug: z.string(), confirm: z.literal(true) })).jsonSchema
        const compatible = geminiCompatibleSchema(schema) as { properties: Record<string, Record<string, unknown>> }
        expect(compatible.properties.confirm).not.toHaveProperty('const')
        expect(compatible.properties.confirm).not.toHaveProperty('enum')
        expect(compatible.properties.confirm.type).toBe('boolean')
    })

    it('keeps the usable values of an enum, and the enum only while one is left', () => {
        expect(geminiCompatibleSchema({ type: 'string', enum: ['draft', '', 'published'] })).toEqual({ type: 'string', enum: ['draft', 'published'] })
        expect(geminiCompatibleSchema({ type: 'integer', enum: [1, 2] })).toEqual({ type: 'integer' })
        expect(geminiCompatibleSchema({ type: 'string', const: 'now' })).toEqual({ type: 'string', const: 'now' })
    })

    it('leaves a property that happens to be named enum or const alone', () => {
        const schema = { type: 'object', properties: { enum: { type: 'string' }, const: { type: 'boolean' } }, required: ['enum'] }
        expect(geminiCompatibleSchema(schema)).toEqual(schema)
    })
})

describe('googleToolSchemaMiddleware', () => {
    it('rewrites the function tools sent to Google, and nothing else', async () => {
        const params = {
            prompt: [],
            tools: [
                { type: 'function' as const, name: 'buffer_create_post', inputSchema: { type: 'object' as const, properties: { thumbnailUrl: BUFFER_THUMBNAIL } } },
                { type: 'provider' as const, id: 'google.google_search' as const, name: 'google_search', args: {} },
            ],
        }
        const transformed = await googleToolSchemaMiddleware.transformParams!({ type: 'stream', params, model: {} as never })
        expect(transformed.tools?.[0]).toMatchObject({ inputSchema: { properties: { thumbnailUrl: { anyOf: [{ format: 'uri' }, { type: 'string' }] } } } })
        expect(transformed.tools?.[1]).toBe(params.tools[1])
        expect(params.tools[0].inputSchema.properties.thumbnailUrl).toBe(BUFFER_THUMBNAIL)
    })
})
