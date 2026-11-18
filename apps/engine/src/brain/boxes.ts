import { existsSync } from 'node:fs'
import { brainDbPath } from '../config/paths.js'
import { getBrainDb } from '../db/brainDb.js'

// The engine has no notion of Boxes: the hub tells it which one each coworker sits in, so what a
// coworker adds to the Brain is filed under it and it reads that Box first.
export async function setAgentBoxes(boxes: Record<string, string | null>): Promise<void> {
    const client = await getBrainDb()
    await client.batch(
        [
            { sql: 'DELETE FROM brain_agent_boxes', args: [] },
            ...Object.entries(boxes).map(([agentId, spaceId]) => ({ sql: 'INSERT INTO brain_agent_boxes(agent_id, space_id) VALUES (?, ?)', args: [agentId, spaceId] })),
        ],
        'write'
    )
}

export async function agentSpaceId(agentId: string): Promise<string | null> {
    if (!existsSync(brainDbPath())) return null
    const client = await getBrainDb()
    const rs = await client.execute({ sql: 'SELECT space_id FROM brain_agent_boxes WHERE agent_id = ?', args: [agentId] })
    const spaceId = rs.rows[0]?.space_id
    return spaceId == null ? null : String(spaceId)
}
