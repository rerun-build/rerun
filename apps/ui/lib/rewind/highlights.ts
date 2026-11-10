import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { RewindHighlight } from '@rerun/contracts'
import { generateText } from 'ai'
import { z } from 'zod'
import type { ReportedAgent } from './merge'

// Plain JSON rather than structured output, for the same reason as lib/company/analyze.ts: Gemini on
// OpenRouter through the openai-compatible provider does not take a json_schema response_format.
const HIGHLIGHTS_MODEL = process.env.RERUN_REWIND_MODEL ?? 'google/gemini-2.5-flash'
const MAX_HIGHLIGHTS = 3
const MAX_OUTPUTS_PER_AGENT = 5

const highlightsSchema = z.object({
    highlights: z
        .array(
            z.object({
                agent: z.string(),
                headline: z.string().trim().min(1).max(60),
                detail: z.string().trim().min(1).max(160),
            })
        )
        .max(MAX_HIGHLIGHTS),
})

function highlightsModel() {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) return null
    return createOpenAICompatible({ name: 'openrouter', apiKey, baseURL: 'https://openrouter.ai/api/v1' })(HIGHLIGHTS_MODEL)
}

function extractJson(text: string): unknown {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
        return JSON.parse(match[0])
    } catch {
        return null
    }
}

function digestOf(agents: ReportedAgent[]): string {
    return agents
        .filter(agent => agent.report.outputs.length > 0)
        .map(agent => {
            const outputs = agent.report.outputs
                .slice(0, MAX_OUTPUTS_PER_AGENT)
                .map(output => `- [${output.source}] "${output.title}": ${output.text}`)
                .join('\n')
            return `## ${agent.name} (${agent.report.runs.total} runs)\n${outputs}`
        })
        .join('\n\n')
}

// A failure here costs the story one slide, never the whole Rewind.
// `language` is the English name of the workspace's language: the slide is read by its members.
export async function writeHighlights(agents: ReportedAgent[], language = 'English'): Promise<RewindHighlight[]> {
    const model = highlightsModel()
    const digest = digestOf(agents)
    if (!model || !digest) return []

    const prompt = `You write the "highlights" slide of a weekly recap, in the spirit of Spotify Wrapped, for a team whose AI coworkers worked for them this week.

Below is what each coworker answered at the end of some of its runs this week ("schedule" and "trigger" runs happened on their own, "chat" runs were asked by a person).

${digest}

Pick the ${MAX_HIGHLIGHTS} most concrete, impressive accomplishments. Prefer finished deliverables with numbers (articles published, emails triaged, leads found, reports sent) over routine chatter. Never invent a number or a fact that is not in the text. Skip failures and anything that only asks a question.

For each one:
- "agent": the coworker name exactly as written after "##".
- "headline": 2 to 6 punchy words, like "Shipped 4 SEO articles". No trailing period, no emoji.
- "detail": one short sentence with the specifics.

Write the headlines and details in ${language}, keeping the coworker names exactly as written. Respond with ONLY a JSON object, no prose, no code fences:
{ "highlights": [{ "agent": "...", "headline": "...", "detail": "..." }] }`

    try {
        const { text } = await generateText({ model, prompt })
        const parsed = highlightsSchema.safeParse(extractJson(text))
        if (!parsed.success) return []
        const byName = new Map(agents.map(agent => [agent.name, agent.agentId]))
        return parsed.data.highlights.flatMap(highlight => {
            const agentId = byName.get(highlight.agent)
            return agentId ? [{ agentId, headline: highlight.headline, detail: highlight.detail }] : []
        })
    } catch {
        return []
    }
}
