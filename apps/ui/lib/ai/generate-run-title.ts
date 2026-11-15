import { generateObject } from 'ai'
import { z } from 'zod'

import { hasOpenRouterKey, openrouter } from '@/lib/ai/openrouter'

const RUN_TITLE_MAX = 80

const schema = z.object({
    title: z.string().describe('At most 8 words saying what the run did or found, with the concrete names and counts. No trailing period, never the routine name.'),
    nothingToReport: z.boolean().describe('True when the run found nothing new and did nothing.'),
})

export type RunTitle = { title: string; nothingToReport: boolean }

export async function generateRunTitle(routineName: string, report: string, failed: boolean): Promise<RunTitle | null> {
    if (!hasOpenRouterKey()) return null
    try {
        const { object } = await generateObject({
            model: openrouter('anthropic/claude-haiku-4.5'),
            schema,
            prompt: `An automated routine named "${routineName}" just ${failed ? 'failed' : 'finished'}. Title its run in the list of conversations, in the same language as the ${failed ? 'error' : 'report'}.${failed ? ' Say what went wrong in plain words.' : ''}\n\n${failed ? 'Error' : 'Report'}:\n${report}`,
            abortSignal: AbortSignal.timeout(15_000),
        })
        const title = object.title.trim().replace(/\.$/, '').slice(0, RUN_TITLE_MAX)
        return title ? { title, nothingToReport: !failed && object.nothingToReport } : null
    } catch (err) {
        console.error('[run-title] generation failed', err)
        return null
    }
}
