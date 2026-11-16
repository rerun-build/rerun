import { asc, eq } from 'drizzle-orm'
import { getSystemDb } from '../systemDb.js'
import { runSteps, toolCalls, type RunStepRow, type ToolCallRow } from '../schema.js'

export async function insertRunStep(agentId: string, row: RunStepRow): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.insert(runSteps).values(row)
}

export async function insertToolCall(agentId: string, row: ToolCallRow): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.insert(toolCalls).values(row)
}

export async function updateToolCall(agentId: string, id: string, patch: Pick<ToolCallRow, 'resultJson' | 'isError'>): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(toolCalls).set(patch).where(eq(toolCalls.id, id))
}

export async function listRunSteps(agentId: string, runId: string): Promise<RunStepRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.stepNumber))
}

export async function listToolCalls(agentId: string, runId: string): Promise<ToolCallRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select().from(toolCalls).where(eq(toolCalls.runId, runId)).orderBy(asc(toolCalls.createdAt))
}
