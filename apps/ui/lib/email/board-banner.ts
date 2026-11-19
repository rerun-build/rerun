import type { SupabaseClient } from '@supabase/supabase-js'
import { SCENE_HEIGHT, SCENE_WIDTH } from '@moldwright/emails'
import type { Database } from '@/app/api/database.types'
import { boardImageUrl } from '@/lib/og/board-image'
import { loadTeam, teamBoardScene, type TeamMember, type TeamStatus } from '@/lib/og/team-board'
import { warmImage } from '@/lib/og/warm'

export const BANNER_WARM_BACKGROUND_MS = 25_000
export const BANNER_WARM_INLINE_MS = 6_000

export async function emailBoardBanner(supabase: SupabaseClient<Database>, workspaceId: number, status: TeamStatus, timeoutMs: number): Promise<string | undefined> {
    try {
        const team = await loadTeam(supabase, workspaceId, typeof status === 'string' ? [] : Object.keys(status))
        return await teamBoardBanner(team, status, timeoutMs)
    } catch (error) {
        console.error('[email] board banner failed', workspaceId, error)
        return undefined
    }
}

export async function teamBoardBanner(team: TeamMember[], status: TeamStatus, timeoutMs: number): Promise<string | undefined> {
    try {
        const url = boardImageUrl(teamBoardScene(team, status), { width: SCENE_WIDTH, height: SCENE_HEIGHT })
        return (await warmImage(url, timeoutMs)) ? url : undefined
    } catch (error) {
        console.error('[email] board banner failed', error)
        return undefined
    }
}
