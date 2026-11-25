import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { markManagedAuthorized } from '@/app/api/_services/services.service'
import { connectVaultManaged, vaultSignInContext } from '@/app/api/_services/vault-sign-in.service'
import { putConnectorToken } from '@/lib/vault/tokens'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, decodeManagedContext, exchangeManagedCode, managedTokenBundle } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import type { ManagedProvider } from '@/lib/managed/types'
import { oauthPopupResponse, popupFailureLabel, popupSuccessLabel } from '@/lib/oauth/popup-result'
import { refusal, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { callbackGrant, type CallbackGrant } from '@/lib/oauth/mobile-ticket'
import { returnToHost, type HostReturn } from '@/lib/oauth/host-sign-in'
import { parkForHost, parkSignIn } from '@/lib/oauth/pending-grant'
import { requireAgentWorkspaceId, workspaceActor } from '@/app/api/_auth/access'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { DesktopShellChannel } from '@rerun/contracts'

type CallbackResult = { ok: true; email?: string; claim?: string } | ({ ok: false } & ActionRefusal)

// `key` lets a page holding several Connect buttons of one app tell which account just finished.
// It is absent when the context could not be read, so every listener still hears that failure.
async function htmlResult(result: CallbackResult, key?: string): Promise<NextResponse> {
    const target = key ? { key } : {}
    if (result.ok) {
        return oauthPopupResponse({
            channel: 'managed-oauth',
            message: { type: 'managed-oauth-success', ...target, email: result.email },
            label: await popupSuccessLabel(result.email),
        })
    }
    const { ok: _ok, ...failure } = result
    return oauthPopupResponse({ channel: 'managed-oauth', message: { type: 'managed-oauth-error', ...target, ...failure }, label: await popupFailureLabel(failure) })
}

async function accountEmailOf(provider: ManagedProvider, accessToken: string): Promise<string | undefined> {
    return provider.oauth.accountEmail?.(accessToken).catch(() => undefined)
}

function hostReturnOf(raw: string): HostReturn | undefined {
    try {
        return decodeManagedContext(raw).host
    } catch {
        return undefined
    }
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
    const raw = state ? (await cookies()).get(MANAGED_COOKIE_PREFIX + state)?.value : undefined
    const host = raw ? hostReturnOf(raw) : undefined

    const finish = async (result: CallbackResult): Promise<NextResponse> => {
        const res = host
            ? await returnToHost(host, result.ok ? { ok: true, claim: result.claim ?? '' } : result).catch(() => htmlResult({ ok: false, ...refusal('oauthSessionExpired') }, key))
            : mobile
              ? new NextResponse(null, { status: 302, headers: { Location: appReturnUrl(result, desktop) } })
              : await htmlResult(result, key)
        if (state) res.cookies.delete({ name: MANAGED_COOKIE_PREFIX + state, path: MANAGED_COOKIE_PATH })
        return res
    }

    if (providerError) {
        const description = url.searchParams.get('error_description')
        console.warn(`[managed:${providerId}] authorize rejected:`, Object.fromEntries(url.searchParams))
        return finish({ ok: false, error: description ? `${providerError}: ${description}` : providerError })
    }
    if (!code || !state) return finish({ ok: false, ...refusal('missingCodeOrState') })

    if (!raw) return finish({ ok: false, ...refusal('oauthSessionExpired') })

    try {
        const provider = getManagedProvider(providerId)
        if (!provider) return finish({ ok: false, ...refusal('unknownOAuthProvider', { provider: providerId }) })

        const clientId = process.env[provider.oauth.clientIdEnv]
        const clientSecret = process.env[provider.oauth.clientSecretEnv]
        if (!clientId || !clientSecret) return finish({ ok: false, ...refusal('providerNotConfigured', { provider: provider.label }) })

        const ctx = decodeManagedContext(raw)
        mobile = ctx.mobileGrant !== undefined
        key = ctx.key
        if (ctx.provider !== providerId) return finish({ ok: false, ...refusal('providerMismatch') })
        const grant = callbackGrant(ctx)
        desktop = grant?.desktop
        const exchange = async () => {
            const token = await exchangeManagedCode(provider.oauth, clientId, clientSecret, ctx, code)
            return { token, email: await accountEmailOf(provider, token.accessToken) }
        }
        // The app has no session here: the token waits for its claim, the client secret stays in the env.
        const park = async (pending: CallbackGrant) => {
            const { token, email } = await exchange()
            await parkSignIn(pending, { kind: 'managed', key: ctx.key, provider: ctx.provider, serverName: ctx.serverName, token, email })
            return finish({ ok: true, email, claim: pending.jti })
        }

        if (ctx.vault) {
            if (grant) return await park(grant)
            const vault = await vaultSignInContext(ctx.vault.workspaceId)
            const { token, email } = await exchange()
            await connectVaultManaged(vault, ctx.vault.itemId, providerId, token, email)
            return finish({ ok: true, email })
        }
        if (host) {
            const { token, email } = await exchange()
            return finish({ ok: true, email, claim: await parkForHost(host, { kind: 'managed', key: ctx.key, provider: ctx.provider, serverName: ctx.serverName, token, email }) })
        }
        const workspaceId = grant?.workspaceId ?? (await requireAgentWorkspaceId(ctx.agentId, 'manage', ctx.workspaceId))
        // The session passed `manage` on the coworker's Box just above, or the grant was minted for someone who did.
        const actor = workspaceActor(workspaceId)
        const { conn, engineAgentId } = await resolveAgentTarget(ctx.agentId, 'manage', actor)
        if (grant) return await park(grant)

        const { token, email } = await exchange()
        await putConnectorToken(conn, engineAgentId, ctx.serverName, managedTokenBundle(provider, token))
        await markManagedAuthorized(ctx.agentId, ctx.key, email, actor)
        return finish({ ok: true, email })
    } catch (err) {
        return finish({ ok: false, ...refusalOf(err, 'authorizationFailed') })
    }
}
