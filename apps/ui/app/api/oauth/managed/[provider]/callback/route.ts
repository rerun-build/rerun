import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { markManagedAuthorized } from '@/app/api/_services/services.service'
import { putMcpToken } from '@/lib/engine/client'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, decodeManagedContext, exchangeManagedCode } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { oauthPopupResponse } from '@/lib/oauth/popup-result'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { callbackGrant } from '@/lib/oauth/mobile-ticket'
import { parkSignIn } from '@/lib/oauth/pending-grant'
import { requireAgentWorkspaceId, workspaceActor } from '@/app/api/_auth/access'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { DesktopShellChannel } from '@rerun/contracts'

type CallbackResult = { ok: true; email?: string; claim?: string } | { ok: false; error: string }

// `key` lets a page holding several Connect buttons of one app tell which account just finished.
// It is absent when the context could not be read, so every listener still hears that failure.
function htmlResult(result: CallbackResult, key?: string): NextResponse {
    const target = key ? { key } : {}
    return oauthPopupResponse({
        channel: 'managed-oauth',
        message: result.ok ? { type: 'managed-oauth-success', ...target, email: result.email } : { type: 'managed-oauth-error', ...target, error: result.error },
        label: result.ok ? `Connected${result.email ? ` as ${result.email}` : ''}. You can close this window.` : `Authorization failed: ${result.error}`,
    })
}

// Managed OAuth redirect target on our own domain. Exchanges the code for tokens using Rerun's
// client, hands the bundle to the ENGINE token store (never Supabase), marks the service
// active, then messages the opener popup and closes.
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider: providerId } = await params
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const providerError = url.searchParams.get('error')

    // Only known once the context is decoded, and `finish` is what every exit path goes through.
    let mobile = false
    // The desktop app's channel, when it started the sign-in: where the browser goes back to.
    let desktop: DesktopShellChannel | undefined
    let key: string | undefined

    const finish = (result: CallbackResult): NextResponse => {
        const res = mobile ? new NextResponse(null, { status: 302, headers: { Location: appReturnUrl(result, desktop) } }) : htmlResult(result, key)
        if (state) res.cookies.delete({ name: MANAGED_COOKIE_PREFIX + state, path: MANAGED_COOKIE_PATH })
        return res
    }

    if (providerError) {
        const description = url.searchParams.get('error_description')
        console.warn(`[managed:${providerId}] authorize rejected:`, Object.fromEntries(url.searchParams))
        return finish({ ok: false, error: description ? `${providerError}: ${description}` : providerError })
    }
    if (!code || !state) return finish({ ok: false, error: 'Missing code or state' })

    const raw = (await cookies()).get(MANAGED_COOKIE_PREFIX + state)?.value

    if (!raw) return finish({ ok: false, error: 'Session expired, please retry' })

    try {
        const provider = getManagedProvider(providerId)
        if (!provider) return finish({ ok: false, error: `Unknown provider: ${providerId}` })

        const clientId = process.env[provider.oauth.clientIdEnv]
        const clientSecret = process.env[provider.oauth.clientSecretEnv]
        if (!clientId || !clientSecret) return finish({ ok: false, error: `${provider.label} is not configured on this server.` })

        const ctx = decodeManagedContext(raw)
        mobile = ctx.mobileGrant !== undefined
        key = ctx.key
        if (ctx.provider !== providerId) return finish({ ok: false, error: 'Provider mismatch, please retry' })
        const grant = callbackGrant(ctx)
        desktop = grant?.desktop
        const workspaceId = grant?.workspaceId ?? (await requireAgentWorkspaceId(ctx.agentId))
        // The session passed `manage` on the coworker's Box just above, or the grant was minted for someone who did.
        const actor = workspaceActor(workspaceId)
        const { conn, engineAgentId } = await resolveAgentTarget(ctx.agentId, actor, 'manage')
        const token = await exchangeManagedCode(provider.oauth, clientId, clientSecret, ctx, code)
        const email = provider.oauth.accountEmail ? await provider.oauth.accountEmail(token.accessToken).catch(() => undefined) : undefined

        // The app has no session here: the token waits for its claim, the client secret stays in the env.
        if (grant) {
            await parkSignIn(grant, { kind: 'managed', key: ctx.key, provider: ctx.provider, serverName: ctx.serverName, token: { accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt, scope: token.scope }, email })
            return finish({ ok: true, email, claim: grant.jti })
        }

        await putMcpToken(conn, engineAgentId, ctx.serverName, {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
            scope: token.scope,
            tokenEndpoint: provider.oauth.tokenEndpoint,
            clientId,
            clientSecret,
            obtainedAt: Date.now(),
        })
        await markManagedAuthorized(ctx.agentId, ctx.key, email, actor)
        return finish({ ok: true, email })
    } catch (err) {
        return finish({ ok: false, error: err instanceof Error ? err.message : 'Authorization failed' })
    }
}
