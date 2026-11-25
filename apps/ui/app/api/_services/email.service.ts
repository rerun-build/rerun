import 'server-only'
import * as React from 'react'
import { AccountSignedOut, AgentNotification, BudgetExhausted, LifetimeCode, OrganizationCreditOut, PublishedAccessCode, RunFailed, SignInCode, WorkspaceInvite, accountSignedOutSubject, agentNotificationTitle, renderEmail, type AccountSignedOutProps } from '@rerun/emails'
import { emailTranslator } from '@rerun/emails/i18n'
import type { Locale } from '@rerun/i18n'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { brandAppUrl } from '@/lib/brand/urls'
import { APP_URL, IS_PRODUCTION_MAILER, getResendClient as getClient, redirectDelivery, type SendEmailResult } from '@/lib/email/client'
import { emailSender } from '@/lib/email/sender'
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
    brand?: Brand
}

export async function sendNotificationEmail(input: NotificationEmailInput): Promise<SendEmailResult> {
    const brand = input.brand ?? RERUN_BRAND
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
            ...emailSender(brand),
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
    brand?: Brand
}

export async function sendBudgetExhaustedEmail(input: BudgetExhaustedEmailInput): Promise<SendEmailResult> {
    const brand = input.brand ?? RERUN_BRAND
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping budget exhausted email')
        return { ok: true, id: null }
    }

    const t = emailTranslator(input.locale, brand.name)
    const element = React.createElement(BudgetExhausted, {
        resetLabel: input.resetLabel,
        creditsUrl: input.creditsUrl,
        boardUrl: input.boardUrl,
        appUrl: brandAppUrl(brand),
        unsubscribeUrl: input.unsubscribeUrl,
        locale: input.locale,
        brand,
    })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, input.workspaceName ? t('subjects.budgetExhausted', { workspace: input.workspaceName }) : t('budgetExhausted.heading'))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            ...emailSender(brand),
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

type OrganizationCreditOutEmailInput = {
    to: string
    workspaceName: string | null
    consoleUrl: string
    boardUrl?: string
    locale: Locale
    brand: Brand
}

// To the team of an organization: one of the workspaces it runs has no credit left.
export async function sendOrganizationCreditOutEmail(input: OrganizationCreditOutEmailInput): Promise<SendEmailResult> {
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping organization credit email')
        return { ok: true, id: null }
    }

    const { to, ...props } = input
    const { html, text } = await renderEmail(React.createElement(OrganizationCreditOut, { ...props, appUrl: brandAppUrl(input.brand) }))
    const t = emailTranslator(input.locale, input.brand.name)
    const delivery = redirectDelivery(to, input.workspaceName ? t('subjects.organizationCreditOut', { workspaceName: input.workspaceName }) : t('organizationCreditOut.preview'))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({ ...emailSender(input.brand), to: delivery.to, subject: delivery.subject, html, text }),
    )
    if (error) {
        console.error('[email] failed to send organization credit email', error)
        return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id ?? null }
}

export async function sendAccountSignedOutEmail({ to, ...input }: Omit<AccountSignedOutProps, 'appUrl'> & { to: string }): Promise<SendEmailResult> {
    const brand = input.brand ?? RERUN_BRAND
    const resend = getClient()
    if (!resend) {
        console.warn('[email] RESEND_API_KEY missing, skipping account signed out email')
        return { ok: true, id: null }
    }

    const { html, text } = await renderEmail(React.createElement(AccountSignedOut, { ...input, brand, appUrl: brandAppUrl(brand) }))
    const delivery = redirectDelivery(to, accountSignedOutSubject(input, emailTranslator(input.locale, brand.name)))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            ...emailSender(brand),
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
    brand?: Brand
}

export async function sendWorkspaceInviteEmail(input: WorkspaceInviteEmailInput): Promise<SendEmailResult> {
    const brand = input.brand ?? RERUN_BRAND
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
        appUrl: brandAppUrl(brand),
        locale: input.locale,
        brand,
    })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale, brand.name)('subjects.workspaceInvite', { workspaceName: input.workspaceName }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            ...emailSender(brand),
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

export async function sendPublishedAccessCodeEmail(input: { to: string; code: string; workspaceName: string; pageTitle: string; expiresInMinutes: number; locale?: Locale; brand?: Brand }): Promise<SendEmailResult> {
    const brand = input.brand ?? RERUN_BRAND
    const resend = getClient()
    if (!resend) {
        if (IS_PRODUCTION_MAILER) console.error('[email] RESEND_API_KEY missing, skipping published access code email')
        else console.warn(`[email] RESEND_API_KEY missing, published access code for ${input.to}: ${input.code}`)
        return { ok: true, id: null }
    }

    const element = React.createElement(PublishedAccessCode, { ...input, brand, appUrl: brandAppUrl(brand) })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale, brand.name)('subjects.publishedAccessCode', { pageTitle: input.pageTitle, code: input.code }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            ...emailSender(brand),
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
            ...emailSender(RERUN_BRAND),
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

export async function sendSignInCodeEmail(input: { to: string; code: string; signInUrl?: string; expiresInMinutes: number; locale?: Locale; brand?: Brand }): Promise<SendEmailResult> {
    const brand = input.brand ?? RERUN_BRAND
    const resend = getClient()
    if (!resend) {
        // Local dev and staging send no email at all, so the log is the only way to sign in there.
        // Never on the production mailer, where a logged code would open a real account.
        if (IS_PRODUCTION_MAILER) console.error('[email] RESEND_API_KEY missing, skipping sign-in code email')
        else console.warn(`[email] RESEND_API_KEY missing, sign-in code for ${input.to}: ${input.code}`)
        return { ok: true, id: null }
    }

    const element = React.createElement(SignInCode, { code: input.code, signInUrl: input.signInUrl, expiresInMinutes: input.expiresInMinutes, appUrl: brandAppUrl(brand), locale: input.locale, brand })
    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(input.to, emailTranslator(input.locale, brand.name)('subjects.signInCode', { code: input.code }))

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            ...emailSender(brand),
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

function buildNotificationEmail({ kind, app, opensConversation, brand = RERUN_BRAND, ...input }: NotificationEmailInput): { element: React.ReactElement; subject: string } {
    const t = emailTranslator(input.locale, brand.name)
    const appUrl = brandAppUrl(brand)
    if (kind === 'error') return { subject: t('runFailed.heading', { agentName: input.agentName }), element: React.createElement(RunFailed, { ...input, brand, appUrl }) }
    return {
        subject: agentNotificationTitle({ kind, agentName: input.agentName, app }, t),
        element: React.createElement(AgentNotification, { ...input, kind, app, opensConversation, brand, appUrl }),
    }
}
