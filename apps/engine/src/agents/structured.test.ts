import { vi } from 'vitest'

const answer = vi.hoisted(() => ({ next: undefined as (() => Promise<{ text: string }>) | undefined }))

vi.mock('ai', async importOriginal => {
    const actual = await importOriginal<typeof import('ai')>()
    return { ...actual, generateText: () => answer.next!() }
})

const { describe, expect, it } = await import('vitest')
const { z } = await import('zod')
const { NoObjectGeneratedError } = await import('ai')
const { generateStructured } = await import('./structured.js')

const schema = z.object({ name: z.string(), body: z.string() })
const model = 'test-model' as never
const prompt = 'Write it.'

describe('generateStructured', () => {
    it('reads the object from the text when the SDK produced no output', async () => {
        answer.next = async () => ({ text: '{"name":"Publishing","body":"Draft, review, publish."}' })
        expect(await generateStructured({ model, schema, prompt })).toEqual({ name: 'Publishing', body: 'Draft, review, publish.' })
    })

    it('tolerates a fenced answer', async () => {
        answer.next = async () => ({ text: '```json\n{"name":"Publishing","body":"Draft."}\n```' })
        expect(await generateStructured({ model, schema, prompt })).toEqual({ name: 'Publishing', body: 'Draft.' })
    })

    it('tolerates prose around the object', async () => {
        answer.next = async () => ({ text: 'Here it is:\n{"name":"Publishing","body":"Draft."}\nDone.' })
        expect(await generateStructured({ model, schema, prompt })).toEqual({ name: 'Publishing', body: 'Draft.' })
    })

    it('recovers the object an API provider rejected for its fences', async () => {
        answer.next = async () => {
            throw new NoObjectGeneratedError({ message: 'No object generated', text: '```json\n{"name":"Publishing","body":"Draft."}\n```', response: undefined, usage: undefined, finishReason: 'stop' } as never)
        }
        expect(await generateStructured({ model, schema, prompt })).toEqual({ name: 'Publishing', body: 'Draft.' })
    })

    it('rethrows the provider error when its text holds nothing usable', async () => {
        answer.next = async () => {
            throw new NoObjectGeneratedError({ message: 'No object generated', text: 'I cannot do that.', response: undefined, usage: undefined, finishReason: 'stop' } as never)
        }
        await expect(generateStructured({ model, schema, prompt })).rejects.toThrow('No object generated')
    })

    it('fails on text that holds no object', async () => {
        answer.next = async () => ({ text: 'Sure, what would you like the skill to say?' })
        await expect(generateStructured({ model, schema, prompt })).rejects.toThrow('no JSON object')
    })

    it('fails on an object that misses the schema', async () => {
        answer.next = async () => ({ text: '{"name":"Publishing"}' })
        await expect(generateStructured({ model, schema, prompt })).rejects.toThrow()
    })
})
