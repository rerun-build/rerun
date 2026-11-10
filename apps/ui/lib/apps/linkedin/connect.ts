import { getMe, login, type LinkupLoginResult } from '@/lib/apps/linkup/client'
import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'

// How a LinkedIn account is signed in at Linkup, and what it is known by once it is.

export type LinkedinCredentials = { email: string; password: string } | { loginToken: string }

// `app_challenge` is asked for first: approving in the LinkedIn app is one tap, where a code means
// switching to an inbox. LinkedIn may still impose a code, which the result says.
export function loginLinkedin(credentials: LinkedinCredentials, { country, accountName }: { country: string; accountName: string }): Promise<LinkupLoginResult> {
    const secret = 'loginToken' in credentials ? { login_token: credentials.loginToken } : { email: credentials.email, password: credentials.password }
    return login('linkedin', { ...secret, country, challenge_type: 'app_challenge', account_name: accountName })
}

type LinkedinMe = { public_id: string; first_name: string | null; last_name: string | null }

// The member id is the public id: one free trial per LinkedIn profile, one connection per profile
// and per workspace.
export async function linkedinProfile(accountId: string): Promise<{ label: string; memberId: string }> {
    const me = await getMe<LinkedinMe>(accountId)
    return { label: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.public_id, memberId: me.public_id }
}

export const LINKEDIN_WEBHOOK_EVENTS = ['message_received', 'accepted_invitation', 'invitation_received'] as const

export function linkedinSignInRefusal(message: string): { code: ErrorCode; params?: ErrorParams } {
    if (/username|password|credential/i.test(message)) return { code: 'linkedinWrongCredentials' }
    return { code: 'linkedinSignInRefused', params: { message } }
}
