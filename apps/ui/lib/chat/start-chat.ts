import { chat } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'

type ChatParams = Parameters<typeof chat>[2]

export const QUEUED_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 4_000, 4_000, 4_000, 4_000]

export async function startChat(conn: EngineConnection, engineAgentId: string, params: ChatParams, delays: readonly number[] | null): Promise<Response> {
    let res = await chat(conn, engineAgentId, params)
    for (const delay of delays ?? []) {
        if (res.status !== 409) break
        await res.body?.cancel().catch(() => {})
        await new Promise(resolve => setTimeout(resolve, delay))
        res = await chat(conn, engineAgentId, params)
    }
    return res
}
