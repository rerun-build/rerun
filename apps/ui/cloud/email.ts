import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import type { NotificationKind } from '@/lib/engine/types'
import type { NotificationRecipients, RoutedMember } from '@/lib/notifications/routing'
import type { StoredNotification } from '@/lib/notifications/inbound'
import type { TeamStatus } from '@/lib/og/team-board'

// This build sends no email: sign-in emails are Supabase's own (the SMTP of the project), and an
// invitation hands its link to the person who sent it. Every send is logged and reported skipped.
export const EMAIL_DELIVERY = false

export type SendEmailResult = { ok: true; id: string | null; skipped?: boolean } | { ok: false; error: string }

function skipped(kind: string, to: string): SendEmailResult {
    console.info(`[email] no mailer in this build, ${kind} to ${to} not sent`)
    return { ok: true, id: null, skipped: true }
}

export async function sendNotificationEmail(input: {
    to: string
    kind: NotificationKind
    agentName: string
    message: string
    runId?: string | null
    reason?: string
    boardUrl?: string
    conversationUrl?: string
    unsubscribeUrl?: string
}): Promise<SendEmailResult> {
    return skipped(`${input.kind} notification`, input.to)
}

export async function sendIncidentResolvedEmail(input: {
    to: string
    agentName: string
    sourceLabel: string
    reason?: string
    boardUrl?: string
    conversationUrl?: string
    unsubscribeUrl?: string
}): Promise<SendEmailResult> {
    return skipped('incident resolved', input.to)
}

export async function sendWorkspaceInviteEmail(input: { to: string; workspaceName: string; inviteUrl: string; invitedByEmail?: string; boardUrl?: string }): Promise<SendEmailResult> {
    return skipped('workspace invite', input.to)
}

export async function sendPublishedAccessCodeEmail(input: { to: string; code: string; workspaceName: string; pageTitle: string; expiresInMinutes: number }): Promise<SendEmailResult> {
    return skipped('published access code', input.to)
}

export async function sendSignInCodeEmail(input: { to: string; code: string; signInUrl?: string; expiresInMinutes: number }): Promise<SendEmailResult> {
    return skipped('sign-in code', input.to)
}

export const BANNER_WARM_BACKGROUND_MS = 0
export const BANNER_WARM_INLINE_MS = 0

export async function emailBoardBanner(_supabase: SupabaseClient<Database>, _workspaceId: number, _status: TeamStatus, _timeoutMs: number): Promise<string | undefined> {
    return undefined
}

export function buildUnsubscribeUrl(_userId: string, _appUrl?: string, _scope?: 'runs'): string | undefined {
    return undefined
}

export function verifyUnsubscribeToken(_token: string): { userId: string; scope: 'runs' | null } | null {
    return null
}

export type PushContext = {
    agentId: string | null
    agentName: string
    conversationId: string | null
    sourceKey: string
    notification: StoredNotification
    recipients: NotificationRecipients
    members: RoutedMember[]
}

// The mobile app talks to Rerun Cloud only, so a self-hosted hub has no device to push to.
export async function pushNotification(_supabase: SupabaseClient<Database>, _context: PushContext): Promise<void> {}
