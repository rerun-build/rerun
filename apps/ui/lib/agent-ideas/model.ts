import { generateObject } from 'ai'
import type { z } from 'zod'

import { openrouter } from '@/lib/ai/openrouter'
import type { CollectorCost } from '@/lib/company/explore/types'

export const IDEAS_MODEL = process.env.RERUN_AGENT_IDEAS_MODEL ?? 'anthropic/claude-opus-5.5'

const TIMEOUT_MS = 180_000

export async function generateIdeasObject<T>(input: { schema: z.ZodType<T>; system: string; prompt: string }): Promise<{ object: T; cost: CollectorCost }> {
    const { object, usage } = await generateObject({
        model: openrouter(IDEAS_MODEL),
        schema: input.schema,
        system: input.system,
        prompt: input.prompt,
        maxOutputTokens: 16_000,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return { object, cost: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }
}
