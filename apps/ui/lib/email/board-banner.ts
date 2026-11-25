// No 'server-only', see lib/email/client.ts: the lifecycle sweeper builds its banners from a
// Trigger.dev task.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CoworkerLook } from '@rerun/contracts'
import { localeDirection, type Locale } from '@rerun/i18n'
import { SCENE_HEIGHT, SCENE_WIDTH } from '@rerun/emails'
import type { Database } from '@/app/api/database.types'
import type { AlertBoard } from '@/lib/og/alert-board'
import { alertBoardUrl, boardImageUrl } from '@/lib/og/board-image'
import { bareCoworkerPortraitUrl } from '@/lib/og/coworker-portrait'
import { loadTeam, teamBoardScene, type TeamStatus } from '@/lib/og/team-board'
import { warmImage } from '@/lib/og/warm'

// A sweep can afford to wait for a cold capture. A request someone is waiting on (an engine
// webhook, an invitation, a Stripe event) cannot, and sends the usual banner instead: the next
// email with the same board finds it in rerun-shot's cache.
export const BANNER_WARM_BACKGROUND_MS = 25_000
export const BANNER_WARM_INLINE_MS = 6_000

/**
 * The workspace's own board, framed like the scene of an email, or undefined when it could not be
 * captured in time: the message then opens on its usual picture. Never throws, a missing banner
 * costs the message its illustration and never its delivery.
 */
export async function emailBoardBanner(supabase: SupabaseClient<Database>, workspaceId: number, status: TeamStatus, timeoutMs: number): Promise<string | undefined> {
    try {
        const team = await loadTeam(supabase, workspaceId, typeof status === 'string' ? [] : Object.keys(status))
        const url = boardImageUrl(teamBoardScene(team, status), { width: SCENE_WIDTH, height: SCENE_HEIGHT })
        return (await warmImage(url, timeoutMs)) ? url : undefined
    } catch (error) {
        console.error('[email] board banner failed', workspaceId, error)
        return undefined
    }
}

/** The close-up an alert email opens on, or undefined when it could not be captured in time. Never throws. */
export async function alertBanner(board: AlertBoard | null | Promise<AlertBoard | null>, timeoutMs: number): Promise<string | undefined> {
    try {
        const scene = await board
        if (!scene) return undefined
        const url = alertBoardUrl(scene)
        return (await warmImage(url, timeoutMs)) ? url : undefined
    } catch (error) {
        console.error('[email] alert banner failed', error)
        return undefined
    }
}

/** A coworker's portrait, turned towards the bubble beside it, or undefined when it could not be captured. Never throws. */
export async function emailPortrait(agentId: string, look: CoworkerLook | null, locale: Locale, timeoutMs: number): Promise<string | undefined> {
    const url = bareCoworkerPortraitUrl(agentId, look, localeDirection(locale) === 'rtl' ? 'left' : 'right')
    return (await warmImage(url, timeoutMs)) ? url : undefined
}
