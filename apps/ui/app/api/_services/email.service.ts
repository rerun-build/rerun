import 'server-only'
import * as React from 'react'
import { AgentNotification, BudgetExhausted, IncidentResolved, PublishedAccessCode, RunFailed, SignInCode, WorkspaceInvite, renderEmail } from '@rerun/emails'
import { emailTranslator, type EmailTranslator } from '@rerun/emails/i18n'
import type { Locale } from '@rerun/i18n'
import { APP_URL, IS_PRODUCTION_MAILER, REPLY_TO, TRANSACTIONAL_FROM as FROM, getResendClient as getClient, redirectDelivery, type SendEmailResult } from '@/lib/email/client'
import { sendThrottled } from '@/lib/email/throttle'
import { listUnsubscribeHeaders } from '@/lib/email/unsubscribeToken'
import type { NotificationKind } from '@/lib/engine/types'

export type { SendEmailResult }

type NotificationEmailInput = {
    to: string
    kind: NotificationKind
    agentName: string
    message: string
    runId?: string | null
    reason?: string
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

    const element = React.createElement(BudgetExhausted, {
        workspaceName: input.workspaceName,
        boardUrl: input.boardUrl,
        appUrl: APP_URL,
        unsubscribeUrl: input.unsubscribeUrl,
        locale: input.locale,
    })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale)('subjects.budgetExhausted'))

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

type IncidentResolvedEmailInput = {
    to: string
    agentName: string
    sourceLabel: string
    reason?: string
    boardUrl?: string
    conversationUrl?: string
    unsubscribeUrl?: string
    locale?: Locale
}

export async function sendIncidentResolvedEmail(input: IncidentResolvedEmailInput): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping incident resolved email')
        return { ok: true, id: null }
    }

    const element = React.createElement(IncidentResolved, {
        agentName: input.agentName,
        sourceLabel: input.sourceLabel,
        reason: input.reason,
        boardUrl: input.boardUrl,
        appUrl: APP_URL,
        conversationUrl: input.conversationUrl,
        unsubscribeUrl: input.unsubscribeUrl,
        locale: input.locale,
    })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale)('subjects.incidentResolved', { agentName: input.agentName }))

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
        console.error('[email] failed to send incident resolved email', error)
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

function buildNotificationEmail(input: NotificationEmailInput): { element: React.ReactElement; subject: string } {
    const { agentName, message, kind, reason, boardUrl, conversationUrl, unsubscribeUrl, locale } = input
    const t = emailTranslator(locale)

    if (kind === 'error') {
        return {
            subject: t('subjects.runFailed', { agentName }),
            element: React.createElement(RunFailed, {
                agentName,
                runId: input.runId ?? '',
                errorMessage: message,
                reason,
                boardUrl,
                appUrl: APP_URL,
                conversationUrl,
                unsubscribeUrl,
                locale,
            }),
        }
    }

    return {
        subject: subjectForKind(kind, agentName, t),
        element: React.createElement(AgentNotification, {
            agentName,
            kind,
            message,
            reason,
            boardUrl,
            appUrl: APP_URL,
            conversationUrl,
            unsubscribeUrl,
            locale,
        }),
    }
}

function subjectForKind(kind: Exclude<NotificationKind, 'error'>, agentName: string, t: EmailTranslator): string {
    switch (kind) {
        case 'done':
            return t('subjects.agentDone', { agentName })
        case 'info':
            return t('subjects.agentInfo', { agentName })
        case 'question':
        case 'approval':
        case 'connector':
            return t('subjects.agentInput', { agentName })
    }
}
