import { getAgentChatTarget } from '@/app/api/_services/chat.service'
import { putConnectorToken } from '@/lib/vault/tokens'
import { oauthPopupResponse, popupFailureLabel } from '@/lib/oauth/popup-result'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, decodeContext, engineClientSecret, exchangeCode } from '@/lib/mcp-oauth'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { callbackGrant } from '@/lib/oauth/mobile-ticket'
import { parkSignIn } from '@/lib/oauth/pending-grant'
import { requireAgentWorkspaceId, requireLightSessionActor, workspaceActor } from '@/app/api/_auth/access'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { putVaultToken } from '@/lib/engine/vault-client'
import { AppError, refusal, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { DesktopShellChannel } from '@rerun/contracts'

type CallbackResult = { ok: true; claim?: string } | ({ ok: false } & ActionRefusal)

// `serverName` lets a page holding several Connect buttons tell which server just finished, the
// page then flips the registry entry it holds for it. It is absent when the context could not be
// read, so every listener still hears that failure.
async function htmlResult(result: CallbackResult, serverName?: string): Promise<NextResponse> {
    const target = serverName ? { serverName } : {}
    if (result.ok) return oauthPopupResponse({ channel: 'mcp-oauth', message: { type: 'mcp-oauth-success', ...target }, label: 'Connected. You can close this window.' })
    const { ok: _ok, ...failure } = result
    return oauthPopupResponse({ channel: 'mcp-oauth', message: { type: 'mcp-oauth-error', ...target, ...failure }, label: await popupFailureLabel(failure) })
}

// OAuth redirect target on our own domain. Exchanges the code for tokens, writes the bundle
// to the engine token store (never Supabase), then messages the opener popup and closes. For the
// app, which has no session here, the bundle is parked instead, for the app to claim with its bearer.
// A pre-registered client's secret is never parked: the claim reads it from the environment again.
export async function GET(req: Request) {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const providerError = url.searchParams.get('error')

    // Only known once the context is decoded, and `finish` is what every exit path goes through.
    let mobile = false
    // The desktop app's channel, when it started the sign-in: where the browser goes back to.
    let desktop: DesktopShellChannel | undefined
    let serverName: string | undefined

    const finish = async (result: CallbackResult): Promise<NextResponse> => {
        const res = mobile ? new NextResponse(null, { status: 302, headers: { Location: appReturnUrl(result, desktop) } }) : await htmlResult(result, serverName)
        if (state) res.cookies.delete({ name: OAUTH_COOKIE_PREFIX + state, path: OAUTH_COOKIE_PATH })
        return res
    }

    if (providerError) return finish({ ok: false, error: providerError })
    if (!code || !state) return finish({ ok: false, ...refusal('missingCodeOrState') })

    const raw = (await cookies()).get(OAUTH_COOKIE_PREFIX + state)?.value

    if (!raw) return finish({ ok: false, ...refusal('oauthSessionExpired') })

    try {
        const ctx = decodeContext(raw)
        mobile = ctx.mobileGrant !== undefined
        serverName = ctx.serverName
        if (ctx.vault) {
            // The member who started it, still allowed to add to this workspace's Vault.
            const actor = await requireLightSessionActor()
            if (actor.workspaceId !== ctx.vault.workspaceId) throw new AppError('signInOtherWorkspace')
            const vaultCtx = await vaultContext(actor)
            await assertCanAdd(actor)
            const token = await exchangeCode(ctx, code)
            await putVaultToken(vaultCtx.conn, ctx.vault.itemId, ctx.serverName, {
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                expiresAt: token.expiresAt,
                scope: token.scope,
                tokenEndpoint: ctx.tokenEndpoint,
                clientId: ctx.clientId,
                clientSecret: engineClientSecret(ctx),
                obtainedAt: Date.now(),
            })
            return finish({ ok: true })
        }
        const grant = callbackGrant(ctx)
        desktop = grant?.desktop
        const workspaceId = grant?.workspaceId ?? (await requireAgentWorkspaceId(ctx.agentId))
        // The session passed `manage` on the coworker's Box just above, or the grant was minted for someone who did.
        const actor = workspaceActor(workspaceId)
        const { conn, engineAgentId } = await getAgentChatTarget(ctx.agentId, 'manage', actor)
        const token = await exchangeCode(ctx, code)
        const bundle = {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
            scope: token.scope,
            tokenEndpoint: ctx.tokenEndpoint,
            clientId: ctx.clientId,
            clientSecret: ctx.clientSecret,
            obtainedAt: Date.now(),
        }
        if (grant) {
            await parkSignIn(grant, { kind: 'mcp', serverName: ctx.serverName, mcpUrl: ctx.mcpUrl, token: bundle })
            return finish({ ok: true, claim: grant.jti })
        }
        await putConnectorToken(conn, engineAgentId, ctx.serverName, { ...bundle, clientSecret: engineClientSecret(ctx) })
        return finish({ ok: true })
    } catch (err) {
        return finish({ ok: false, ...refusalOf(err, 'authorizationFailed') })
    }
}
