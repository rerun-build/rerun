import { generateText } from 'ai'

import { openrouter } from '@/lib/ai/openrouter'

// A first message is often one word shared by several languages ("Regisseur") or a short request
// above a long pasted text in another language: left to guess, the model picked German for a Dutch user.
export function sessionTitlePrompt(firstMessage: string): string {
    return `Generate a short, descriptive title (max 6 words) for a conversation that starts with this message. Write it in the language of the words the person wrote themselves, not of any text they pasted or quoted; when a single word or a name leaves the language unclear, keep their word as it is and never translate it. A message of one or two words is its own title, word for word. Never add a topic that is in neither their words nor the text they pasted. A short request such as "summarize this" or "what should I reply" is never the whole title: say what it is about, in the language of their words (an English request above a German email gets an English title). Reply with only the title, no quotes.\n\nMessage: ${firstMessage}`
}

export async function generateSessionTitle(firstMessage: string): Promise<string> {
    const { text } = await generateText({
        model: openrouter('anthropic/claude-haiku-4.5'),
        prompt: sessionTitlePrompt(firstMessage),
    })
    return text.trim().slice(0, 80)
}
