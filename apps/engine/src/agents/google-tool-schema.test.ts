import { describe, expect, it } from 'vitest'
import { asSchema } from 'ai'
import { z } from 'zod'
import { geminiCompatibleSchema, googleToolSchemaMiddleware } from './google-tool-schema.js'

// Buffer's `create_post`, as its MCP server describes `thumbnailUrl`.
const BUFFER_THUMBNAIL = { anyOf: [{ type: 'string', format: 'uri' }, { type: 'string', const: '' }] }

// `signature` of send_email, reply_to_email and continue_email_thread, as mcp-mail-server@2.1.2 lists it.
const MAIL_SIGNATURE = {
    description: 'Optional signature appended after the new body. Provide text, html, or both.',
    anyOf: [{ required: ['text'] }, { required: ['html'] }],
    type: 'object',
    properties: {
        text: { description: 'Plain-text signature', type: 'string', minLength: 1, maxLength: 10000000 },
        html: { description: 'Trusted HTML signature', type: 'string', minLength: 1, maxLength: 10000000 },
    },
    additionalProperties: false,
}

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

    it('turns a nested union of required-only branches into a sentence, the mail signature', () => {
        const { anyOf: _anyOf, ...signature } = MAIL_SIGNATURE
        expect(geminiCompatibleSchema({ type: 'object', properties: { signature: MAIL_SIGNATURE } })).toEqual({
            type: 'object',
            properties: { signature: { ...signature, description: `${MAIL_SIGNATURE.description}\n\nProvide at least one of: text, html.` } },
        })
    })

    it('says exactly one for a oneOf, and writes the description when there was none', () => {
        const schema = { type: 'object', properties: { target: { type: 'object', properties: { channel: { type: 'string' }, user: { type: 'string' } }, oneOf: [{ required: ['channel'] }, { required: ['user'] }] } } }
        expect(geminiCompatibleSchema(schema)).toEqual({
            type: 'object',
            properties: { target: { type: 'object', properties: { channel: { type: 'string' }, user: { type: 'string' } }, description: 'Provide exactly one of: channel, user.' } },
        })
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

    it('sends the mail tools to Google without the signature union it refuses', async () => {
        const inputSchema = { type: 'object' as const, properties: { to: { type: 'string' }, signature: MAIL_SIGNATURE }, required: ['to'] }
        const params = { prompt: [], tools: [{ type: 'function' as const, name: 'email_send_email', inputSchema }] }
        const transformed = await googleToolSchemaMiddleware.transformParams!({ type: 'stream', params, model: {} as never })
        expect(JSON.stringify(transformed.tools)).not.toContain('anyOf')
        expect(transformed.tools?.[0]).toMatchObject({ inputSchema: { required: ['to'], properties: { signature: { type: 'object', properties: { text: { type: 'string' }, html: { type: 'string' } } } } } })
        expect(MAIL_SIGNATURE.anyOf).toEqual([{ required: ['text'] }, { required: ['html'] }])
    })
})
