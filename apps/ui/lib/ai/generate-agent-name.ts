import { generateText } from 'ai'

import { AGENT_NAME_MAX } from '@moldwright/ui/new-agent/reading'
import { openrouter } from '@/lib/ai/openrouter'

export async function generateAgentName(task: string): Promise<string> {
    const { text } = await generateText({
        model: openrouter('anthropic/claude-haiku-4.5'),
        prompt: `Name the AI coworker a user would create for the task below. Two to four words, at most ${AGENT_NAME_MAX} characters, in the same language as the task, no quotes and no "agent" suffix. Reply with only the name.\n\nTask: ${task}`,
    })
    return text.trim().slice(0, AGENT_NAME_MAX).trimEnd()
}
