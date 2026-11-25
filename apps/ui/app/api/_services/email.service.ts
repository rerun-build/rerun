import 'server-only'
import * as React from 'react'
import { AccountSignedOut, AgentNotification, BudgetExhausted, LifetimeCode, PublishedAccessCode, RunFailed, SignInCode, WorkspaceInvite, accountSignedOutSubject, agentNotificationTitle, renderEmail, type AccountSignedOutProps } from '@rerun/emails'
import { emailTranslator } from '@rerun/emails/i18n'
import type { Locale } from '@rerun/i18n'
import { APP_URL, IS_PRODUCTION_MAILER, REPLY_TO, TRANSACTIONAL_FROM as FROM, getResendClient as getClient, redirectDelivery, type SendEmailResult } from '@/lib/email/client'
import { sendThrottled } from '@/lib/email/throttle'
import { listUnsubscribeHeaders } from '@/lib/email/unsubscribeToken'
import type { IncidentKind } from '@/lib/notifications/routing'

export type { SendEmailResult }

type NotificationEmailInput = {
    to: string
    kind: IncidentKind
    agentName: string
    message: string
    app?: string
    opensConversation?: boolean
    reason?: string
    portraitUrl?: string
    boardUrl?: string
    conversationUrl?: string
    unsubscribeUrl?: string
    locale?: Locale
}

export async function sendNotificationEmail(input: NotificationEmailInput): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        // No API key in this environment (e.g. local dev): skip sending, do not crash.
        console.warn('[email] RESEND_API_KEY missing, skipping notification email')
        return { ok: true, id: null }
    }

    const { element, subject } = buildNotificationEmail(input)
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, subject)

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
            headers: listUnsubscribeHeaders(input.unsubscribeUrl),
        }),
    )
    if (error) {
        console.error('[email] failed to send notification email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

type BudgetExhaustedEmailInput = {
    to: string
    workspaceName: string | null
    resetLabel?: string
    creditsUrl: string
    boardUrl?: string
    unsubscribeUrl?: string
    locale?: Locale
}

export async function sendBudgetExhaustedEmail(input: BudgetExhaustedEmailInput): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping budget exhausted email')
        return { ok: true, id: null }
    }

    const t = emailTranslator(input.locale)
    const element = React.createElement(BudgetExhausted, {
        resetLabel: input.resetLabel,
        creditsUrl: input.creditsUrl,
        boardUrl: input.boardUrl,
        appUrl: APP_URL,
        unsubscribeUrl: input.unsubscribeUrl,
        locale: input.locale,
    })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, input.workspaceName ? t('subjects.budgetExhausted', { workspace: input.workspaceName }) : t('budgetExhausted.heading'))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
            headers: listUnsubscribeHeaders(input.unsubscribeUrl),
        }),
    )
    if (error) {
        console.error('[email] failed to send budget exhausted email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

export async function sendAccountSignedOutEmail({ to, ...input }: Omit<AccountSignedOutProps, 'appUrl'> & { to: string }): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping account signed out email')
        return { ok: true, id: null }
    }

    const { html, text } = await renderEmail(React.createElement(AccountSignedOut, { ...input, appUrl: APP_URL }))
    const delivery = redirectDelivery(to, accountSignedOutSubject(input, emailTranslator(input.locale)))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
            headers: listUnsubscribeHeaders(input.unsubscribeUrl),
        }),
    )
    if (error) {
        console.error('[email] failed to send account signed out email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

type WorkspaceInviteEmailInput = {
    to: string
    workspaceName: string
    inviteUrl: string
    invitedByEmail?: string
    boardUrl?: string
    locale?: Locale
}

export async function sendWorkspaceInviteEmail(input: WorkspaceInviteEmailInput): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping workspace invite email')
        return { ok: true, id: null }
    }

    const element = React.createElement(WorkspaceInvite, {
        workspaceName: input.workspaceName,
        inviteUrl: input.inviteUrl,
        invitedByEmail: input.invitedByEmail,
        boardUrl: input.boardUrl,
        appUrl: APP_URL,
        locale: input.locale,
    })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale)('subjects.workspaceInvite', { workspaceName: input.workspaceName }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
        }),
    )
    if (error) {
        console.error('[email] failed to send workspace invite email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

export async function sendPublishedAccessCodeEmail(input: { to: string; code: string; workspaceName: string; pageTitle: string; expiresInMinutes: number; locale?: Locale }): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        if (IS_PRODUCTION_MAILER) console.error('[email] RESEND_API_KEY missing, skipping published access code email')
        else console.warn(`[email] RESEND_API_KEY missing, published access code for ${input.to}: ${input.code}`)
        return { ok: true, id: null }
    }

    const element = React.createElement(PublishedAccessCode, { ...input, appUrl: APP_URL })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale)('subjects.publishedAccessCode', { pageTitle: input.pageTitle, code: input.code }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
        }),
    )
    if (error) {
        console.error('[email] failed to send published access code email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

export async function sendLifetimeCodeEmail(input: { to: string; code: string; locale?: Locale }): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        if (IS_PRODUCTION_MAILER) console.error('[email] RESEND_API_KEY missing, skipping lifetime code email')
        else console.warn(`[email] RESEND_API_KEY missing, lifetime code for ${input.to}: ${input.code}`)
        return { ok: true, id: null }
    }

    const redeemUrl = `${APP_URL}/redeem?code=${encodeURIComponent(input.code)}`
    const element = React.createElement(LifetimeCode, { code: input.code, redeemUrl, appUrl: APP_URL, locale: input.locale })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale)('subjects.lifetimeCode', { code: input.code }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
        }),
    )
    if (error) {
        console.error('[email] failed to send lifetime code email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

export async function sendSignInCodeEmail(input: { to: string; code: string; signInUrl?: string; expiresInMinutes: number; locale?: Locale }): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        // Local dev and staging send no email at all, so the log is the only way to sign in there.
        // Never on the production mailer, where a logged code would open a real account.
        if (IS_PRODUCTION_MAILER) console.error('[email] RESEND_API_KEY missing, skipping sign-in code email')
        else console.warn(`[email] RESEND_API_KEY missing, sign-in code for ${input.to}: ${input.code}`)
        return { ok: true, id: null }
    }

    const element = React.createElement(SignInCode, { code: input.code, signInUrl: input.signInUrl, expiresInMinutes: input.expiresInMinutes, appUrl: APP_URL, locale: input.locale })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale)('subjects.signInCode', { code: input.code }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            from: FROM,
            replyTo: REPLY_TO,
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
        }),
    )
    if (error) {
        console.error('[email] failed to send sign-in code email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

function buildNotificationEmail({ kind, app, opensConversation, ...input }: NotificationEmailInput): { element: React.ReactElement; subject: string } {
    const t = emailTranslator(input.locale)
    if (kind === 'error') return { subject: t('runFailed.heading', { agentName: input.agentName }), element: React.createElement(RunFailed, { ...input, appUrl: APP_URL }) }
    return {
        subject: agentNotificationTitle({ kind, agentName: input.agentName, app }, t),
        element: React.createElement(AgentNotification, { ...input, kind, app, opensConversation, appUrl: APP_URL }),
    }
}
