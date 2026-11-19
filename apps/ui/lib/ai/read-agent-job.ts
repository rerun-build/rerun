import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

import { AGENT_NAME_MAX, EMPTY_READING, parseJobReading, type JobReading } from '@moldwright/ui/new-agent/reading'
import type { CatalogEntry } from '@/lib/templates/catalog'

const JOB_READER_MODEL = process.env.RERUN_JOB_READER_MODEL ?? 'google/gemini-2.5-flash-lite'
const TIMEOUT_MS = 6000

function jobReaderModel() {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) return null
    return createOpenAICompatible({ name: 'openrouter', apiKey, baseURL: 'https://openrouter.ai/api/v1' })(JOB_READER_MODEL)
}

function instructions(catalog: CatalogEntry[]): string {
    return `You read the description of a job a user wants to hand to a new AI coworker, while they type it.
Return ONLY a JSON object, no prose, no code fence:
{"name": string|null, "apps": string[], "schedule": {"label": string, "source": string}|null}
- name: the coworker's name, two to three words, at most ${AGENT_NAME_MAX} characters, Title Case, same language as the description, no "agent" suffix. null if the description is too short or vague to name.
- apps: slugs from the catalog below that the job needs, named or clearly implied (e.g. "my inbox" implies an email app). Most important first, at most 5. Only slugs from the catalog. [] if none.
- schedule: when the job runs, if the description says so. label is a short rewording (e.g. "Every weekday at 9:00", "When a prospect replies"). source is the exact substring of the description it was read from. null if no timing is stated.

Catalog (slug: name):
${catalog.map(entry => `${entry.slug}: ${entry.name}`).join('\n')}`
}

export async function readAgentJob(text: string, catalog: CatalogEntry[]): Promise<JobReading> {
    const model = jobReaderModel()
    if (!model) return EMPTY_READING

    const { text: reply } = await generateText({
        model,
        system: instructions(catalog),
        prompt: text,
        temperature: 0,
        maxOutputTokens: 300,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return parseJobReading(
        reply,
        text,
        catalog.map(entry => entry.slug)
    )
}
