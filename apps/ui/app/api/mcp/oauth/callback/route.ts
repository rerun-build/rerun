import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { putMcpToken } from '@/lib/engine/client'
import { oauthPopupResponse } from '@/lib/oauth/popup-result'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, decodeContext, engineClientSecret, exchangeCode } from '@/lib/mcp-oauth'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { callbackGrant } from '@/lib/oauth/mobile-ticket'
import { parkSignIn } from '@/lib/oauth/pending-grant'
import { requireAgentWorkspaceId, workspaceActor } from '@/app/api/_auth/access'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { DesktopShellChannel } from '@rerun/contracts'

type CallbackResult = { ok: true; claim?: string } | { ok: false; error: string }

function htmlResult(result: CallbackResult, serverName?: string): NextResponse {
    const target = serverName ? { serverName } : {}
    return oauthPopupResponse({
        channel: 'mcp-oauth',
        message: result.ok ? { type: 'mcp-oauth-success', ...target } : { type: 'mcp-oauth-error', ...target, error: result.error },
        label: result.ok ? 'Connected. You can close this window.' : `Authorization failed: ${result.error}`,
    })
}

export async function GET(req: Request) {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const providerError = url.searchParams.get('error')

    let mobile = false
    let desktop: DesktopShellChannel | undefined
    let serverName: string | undefined

    const finish = (result: CallbackResult): NextResponse => {
        const res = mobile ? new NextResponse(null, { status: 302, headers: { Location: appReturnUrl(result, desktop) } }) : htmlResult(result, serverName)
        if (state) res.cookies.delete({ name: OAUTH_COOKIE_PREFIX + state, path: OAUTH_COOKIE_PATH })
        return res
    }

    if (providerError) return finish({ ok: false, error: providerError })
    if (!code || !state) return finish({ ok: false, error: 'Missing code or state' })

    const raw = (await cookies()).get(OAUTH_COOKIE_PREFIX + state)?.value

    if (!raw) return finish({ ok: false, error: 'Session expired, please retry' })

    try {
        const ctx = decodeContext(raw)
        mobile = ctx.mobileGrant !== undefined
        serverName = ctx.serverName
        const grant = callbackGrant(ctx)
        desktop = grant?.desktop
        const workspaceId = grant?.workspaceId ?? (await requireAgentWorkspaceId(ctx.agentId))
        const actor = workspaceActor(workspaceId)
        const { conn, engineAgentId } = await resolveAgentTarget(ctx.agentId, actor, 'manage')
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
        await putMcpToken(conn, engineAgentId, ctx.serverName, { ...bundle, clientSecret: engineClientSecret(ctx) })
        return finish({ ok: true })
    } catch (err) {
        return finish({ ok: false, error: err instanceof Error ? err.message : 'Authorization failed' })
    }
}
