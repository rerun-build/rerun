import { offersTeamRequests } from '@/lib/brand/connection'
import { chat } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'

export type ChatParams = Parameters<typeof chat>[2]

// A queued message leaves the moment the conversation reads as free on the client, but the engine
// only drops its session claim once the run has written its transcript and torn its provider down,
// which takes seconds on a CLI provider. So a 409 here is the normal path, not an incident.
export const QUEUED_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 4_000, 4_000, 4_000, 4_000]

export async function startChat(conn: EngineConnection, engineAgentId: string, chatParams: ChatParams, delays: readonly number[] | null): Promise<Response> {
    const params = { ...chatParams, teamRequests: await offersTeamRequests(conn) }
    let res = await chat(conn, engineAgentId, params)
    for (const delay of delays ?? []) {
        if (res.status !== 409) break
        await res.body?.cancel().catch(() => {})
        await new Promise(resolve => setTimeout(resolve, delay))
        res = await chat(conn, engineAgentId, params)
    }
    return res
}
