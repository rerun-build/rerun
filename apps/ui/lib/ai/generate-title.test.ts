import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/ai/openrouter', () => ({ openrouter: (model: string) => ({ model }) }))

import { generateText } from 'ai'
import { generateSessionTitle, sessionTitlePrompt } from './generate-title'

beforeEach(() => {
    vi.mocked(generateText).mockReset()
})

describe('sessionTitlePrompt', () => {
    // RER-336: "Regisseur" alone came back as "Regisseur und seine kreative Arbeit" for a Dutch user.
    it('keeps a word whose language is unclear instead of guessing one around it', () => {
        const prompt = sessionTitlePrompt('Regisseur')
        expect(prompt).toContain('Message: Regisseur')
        expect(prompt).toContain('keep their word as it is and never translate it')
        expect(prompt).toContain('A message of one or two words is its own title, word for word')
        expect(prompt).toContain('Never add a topic that is in neither their words nor the text they pasted')
    })

    it('follows the language of the request, not of the text pasted under it', () => {
        expect(sessionTitlePrompt('Maak hero image voor:\nWhat Should Your Agency Actually Be Publishing?')).toContain('the language of the words the person wrote themselves, not of any text they pasted or quoted')
    })

    it('names what a short request above a pasted text is about instead of repeating the request', () => {
        expect(sessionTitlePrompt('What should I reply to this?\n\nSehr geehrter Herr Jansen, ...')).toContain('A short request such as "summarize this" or "what should I reply" is never the whole title')
    })
})

describe('generateSessionTitle', () => {
    it('sends the prompt and returns the answer trimmed to 80 characters', async () => {
        vi.mocked(generateText).mockResolvedValue({ text: `  ${'a'.repeat(100)}\n` } as Awaited<ReturnType<typeof generateText>>)
        expect(await generateSessionTitle('Regisseur')).toBe('a'.repeat(80))
        const { prompt } = vi.mocked(generateText).mock.calls[0][0] as { prompt: string }
        expect(prompt).toBe(sessionTitlePrompt('Regisseur'))
    })
})
