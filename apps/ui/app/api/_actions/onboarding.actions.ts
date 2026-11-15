'use server'

import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { declaredAgentName } from '@rerun/ui/new-agent/declared-agent-name'
import { fallbackAgentName } from '@rerun/ui/new-agent/fallback-agent-name'
import { generateAgentName } from '@/lib/ai/generate-agent-name'
import { readAgentJob } from '@/lib/ai/read-agent-job'
import { readerCatalog } from '@/lib/new-agent/reader-catalog'
import { EMPTY_READING, MAX_READABLE_LENGTH, MIN_READABLE_LENGTH, type JobReading } from '@rerun/ui/new-agent/reading'

export async function nameAgentFromPromptAction(task: string): Promise<string> {
    const trimmed = task.trim().slice(0, 500)
    if (!trimmed) return 'New coworker'
    const declared = declaredAgentName(trimmed)
    if (declared) return declared
    try {
        await requireWorkspaceId()
        return (await generateAgentName(trimmed)) || fallbackAgentName(trimmed)
    } catch {
        return fallbackAgentName(trimmed)
    }
}

export async function readAgentJobAction(description: string): Promise<JobReading> {
    const text = description.trim().slice(0, MAX_READABLE_LENGTH)
    if (text.length < MIN_READABLE_LENGTH) return EMPTY_READING
    try {
        await requireWorkspaceId()
        return await readAgentJob(text, await readerCatalog())
    } catch {
        return EMPTY_READING
    }
}
