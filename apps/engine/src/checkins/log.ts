import { FOREMAN_AGENT_ID, checkinReasonSchema } from '@rerun/contracts'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSystemDb } from '../db/systemDb.js'
import { runs } from '../db/schema.js'

// What a check-in made of its run, kept on the run row: why it woke and what it concluded (`note`,
// its final message), and once it decided to speak, to whom, about which coworkers, under which title,
// and when the hub was told.
export const checkinLogSchema = z.object({
    reason: checkinReasonSchema,
    note: z.string().optional(),
    reportedTo: z.string().optional(),
    about: z.array(z.string()).optional(),
    title: z.string().optional(),
    announcedAt: z.string().optional(),
})
export type CheckinLog = z.infer<typeof checkinLogSchema>

export function parseCheckinLog(json: string | null | undefined): CheckinLog | null {
    if (!json) return null
    try {
        const parsed = checkinLogSchema.safeParse(JSON.parse(json))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

export async function readCheckinLog(runId: string): Promise<CheckinLog | null> {
    const { db } = await getSystemDb(FOREMAN_AGENT_ID)
    const [row] = await db.select({ checkinJson: runs.checkinJson }).from(runs).where(eq(runs.id, runId))
    return parseCheckinLog(row?.checkinJson)
}

// Merged over what the row already holds: the reason is written when the run starts, the rest as it ends.
export async function writeCheckinLog(runId: string, patch: Partial<CheckinLog>): Promise<void> {
    const { db } = await getSystemDb(FOREMAN_AGENT_ID)
    const current = await readCheckinLog(runId)
    const next = checkinLogSchema.parse({ ...current, ...patch })
    await db.update(runs).set({ checkinJson: JSON.stringify(next) }).where(eq(runs.id, runId))
}
