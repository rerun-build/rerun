import type { UIMessage } from 'ai'

// A conversation as long as the phone keeps one (200 messages), written like a real one: questions,
// answers in markdown with lists, code and tables, tool steps, a few hours between the stretches.
const QUESTIONS = ['Can you check the Lyon agencies we spoke about yesterday?', 'What came back from the pricing survey?', 'Draft the weekly recap for the team', 'Which leads are worth a call today?', 'Summarize the support tickets of the night']

const ANSWERS = ['I went through the **14 agencies** on the list:\n\n- 9 answered, 4 of them want a demo this week\n- 3 never opened the email\n- 2 are closed for the holidays\n\nI booked the demos in your calendar and left the details in `agencies.md`.', 'Here is what the survey says, in short:\n\n| Plan | Picked | Would pay more |\n| --- | --- | --- |\n| Starter | 41% | 12% |\n| Team | 37% | 28% |\n| Pro | 22% | 46% |\n\nThe Pro buyers are the least price sensitive: a yearly discount is not needed there.', 'Recap of the week:\n\n1. **Sales**: 6 new accounts, 2 lost, pipeline up 18%\n2. **Product**: voice messages shipped on mobile\n3. **Support**: median reply under 2 hours\n\nI sent it to #team and pinned it.', 'Three leads stand out today:\n\n- **Doctolib**: opened the proposal 4 times since Monday\n- **Qonto**: asked for the security sheet\n- **Alan**: the champion changed jobs, worth a call to the new one\n\nShould I prepare the talking points?', 'Overnight there were 23 tickets. Most are about the export:\n\n```ts\nconst rows = await exportSessions({ from, to })\nif (rows.length > 10_000) throw new Error("too many rows")\n```\n\nThe 10,000 row cap is the cause: I opened an issue and answered the customers with a workaround.']

const MINUTE = 60_000

function at(start: number, index: number): string {
    const stretch = Math.floor(index / 12)
    return new Date(start + stretch * 5 * 60 * MINUTE + (index % 12) * 2 * MINUTE).toISOString()
}

export function longTranscript(count = 200, start = Date.parse('2026-11-12T08:00:00Z')): UIMessage[] {
    return Array.from({ length: count }, (_, index): UIMessage => {
        const turn = Math.floor(index / 2)
        const metadata = { createdAt: at(start, index) }
        if (index % 2 === 0) return { id: `perf-u${turn}`, role: 'user', metadata, parts: [{ type: 'text', text: QUESTIONS[turn % QUESTIONS.length] }] }
        const steps = turn % 3 === 0 ? [{ type: 'tool-web_search', toolCallId: `perf-t${turn}`, state: 'output-available', input: { query: 'agencies Lyon' }, output: { results: [] } }] : []
        return { id: `perf-a${turn}`, role: 'assistant', metadata, parts: [...steps, { type: 'text', text: ANSWERS[turn % ANSWERS.length] }] } as UIMessage
    })
}

// The transcript with the last answer `length` characters further into a reply being streamed.
export function withStreamedReply(messages: UIMessage[], length: number): UIMessage[] {
    const reply = ANSWERS[0].repeat(3).slice(0, length)
    return [...messages, { id: 'perf-streaming', role: 'assistant', parts: [{ type: 'text', text: reply }] }]
}
