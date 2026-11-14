import { generateText } from 'ai'
import cronstrue from 'cronstrue'

import { openrouter } from '@/lib/ai/openrouter'

export type ParsedSchedule = {
    mode: 'cron' | 'runAt'
    cron?: string
    runAt?: string
    timezone?: string
    label: string
}

function extractJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
        const obj: unknown = JSON.parse(match[0])
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
    } catch {
        return null
    }
}

function isValidCron(cron: string): boolean {
    try {
        cronstrue.toString(cron, { throwExceptionOnParseError: true })
        return true
    } catch {
        return false
    }
}

export async function parseSchedule(input: string, ctx: { nowIso: string; timezone: string }): Promise<ParsedSchedule | null> {
    const prompt = `You convert a natural-language schedule description into a structured schedule for a cron-like task runner.

Current time (ISO 8601): ${ctx.nowIso}
User timezone (IANA): ${ctx.timezone}

User description: "${input}"

Decide the mode:
- "cron" for a recurring schedule (e.g. "every day at 8am", "tous les lundis", "weekdays at noon").
- "runAt" for a one-shot single execution (e.g. "tomorrow at 3pm", "demain à 15h", "on June 30 at 9am").

Rules:
- For "cron", produce a standard 5-field cron expression: "minute hour day-of-month month day-of-week". Example: weekdays at 8am = "0 8 * * 1-5".
- For "runAt", produce an ISO 8601 instant (with timezone offset) for the next matching moment, resolved relative to the current time and user timezone.
- "timezone" is optional: include an IANA timezone string ONLY if the user explicitly mentions one; otherwise omit it.
- "label" is a short human-readable summary of the schedule, in the same language as the user description.

Respond with ONLY a JSON object, no prose, no code fences:
{ "mode": "cron" | "runAt", "cron": "...", "runAt": "...", "timezone": "...", "label": "..." }`

    let text: string
    try {
        const result = await generateText({ model: openrouter('anthropic/claude-haiku-4.5'), prompt })
        text = result.text
    } catch {
        return null
    }

    const parsed = extractJson(text)
    if (!parsed) return null

    const mode = parsed.mode === 'runAt' ? 'runAt' : parsed.mode === 'cron' ? 'cron' : null
    if (!mode) return null

    const label = typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : ''
    const timezone = typeof parsed.timezone === 'string' && parsed.timezone.trim() ? parsed.timezone.trim() : undefined

    if (mode === 'cron') {
        const cron = typeof parsed.cron === 'string' ? parsed.cron.trim() : ''
        if (!cron || !isValidCron(cron)) return null
        return { mode, cron, timezone, label: label || cron }
    }

    const runAt = typeof parsed.runAt === 'string' ? parsed.runAt.trim() : ''
    if (!runAt || Number.isNaN(Date.parse(runAt))) return null
    return { mode, runAt, timezone, label: label || runAt }
}
