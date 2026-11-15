import { parseServiceRegistryKey, sleep } from '@rerun/contracts'
import { loadManifest, markComposioAuthorized } from '@/app/api/_services/services.service'
import { composioUserId, getConnectedAccount } from '@/lib/composio/client'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, decodeComposioContext } from '@/lib/composio/oauth'
import { oauthPopupResponse } from '@/lib/oauth/popup-result'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { callbackGrant } from '@/lib/oauth/mobile-ticket'
import { parkSignIn } from '@/lib/oauth/pending-grant'
import { requireAgentWorkspaceId, workspaceActor } from '@/app/api/_auth/access'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { DesktopShellChannel } from '@rerun/contracts'

const ACTIVE_POLL_ATTEMPTS = 5
const ACTIVE_POLL_DELAY_MS = 1000

type CallbackResult = { ok: true; accountLabel?: string; claim?: string } | { ok: false; error: string }

function htmlResult(result: CallbackResult, key?: string): NextResponse {
    const target = key ? { key } : {}
    return oauthPopupResponse({
        channel: 'composio-oauth',
        message: result.ok ? { type: 'composio-oauth-success', ...target, accountLabel: result.accountLabel } : { type: 'composio-oauth-error', ...target, error: result.error },
        label: result.ok ? `Connected${result.accountLabel ? ` as ${result.accountLabel}` : ''}. You can close this window.` : `Authorization failed: ${result.error}`,
    })
}

export async function GET(req: Request) {
    const url = new URL(req.url)
    const state = url.searchParams.get('state')
    if (!state) return htmlResult({ ok: false, error: 'Missing state' })

    const cookieName = COMPOSIO_COOKIE_PREFIX + state
    const raw = (await cookies()).get(cookieName)?.value

    let mobile = false
    let desktop: DesktopShellChannel | undefined
    let key: string | undefined

    const finish = (result: CallbackResult): NextResponse => {
        const res = mobile ? new NextResponse(null, { status: 302, headers: { Location: appReturnUrl(result, desktop) } }) : htmlResult(result, key)
        res.cookies.delete({ name: cookieName, path: COMPOSIO_COOKIE_PATH })
        return res
    }

    if (!raw) return finish({ ok: false, error: 'Session expired, please retry' })

    let ctx: ComposioOAuthContext
    try {
        ctx = decodeComposioContext(raw)
        key = ctx.key
    } catch {
        return finish({ ok: false, error: 'Session expired, please retry' })
    }
    mobile = ctx.mobileGrant !== undefined

    const status = url.searchParams.get('status')
    if (status && status !== 'success') {
        const detail = url.searchParams.get('error') ?? url.searchParams.get('error_description')
        console.warn('[composio] authorize rejected:', Object.fromEntries(url.searchParams))
        return finish({ ok: false, error: detail ?? `Connection ${status}` })
    }

    try {
        const grant = callbackGrant(ctx)
        desktop = grant?.desktop
        const workspaceId = grant?.workspaceId ?? (await requireAgentWorkspaceId(ctx.agentId))
        const actor = workspaceActor(workspaceId)
        const userId = composioUserId(ctx.agentId, parseServiceRegistryKey(ctx.key).instanceId)
        const method = (await loadManifest(ctx.key))?.authMethods.find(m => m.kind === 'composio' && m.composio)
        if (!method?.composio) return finish({ ok: false, error: `${ctx.key} has no Composio connection to set up.` })
        const authConfigId = method.composio.authConfigId || ctx.authConfigId
        let account = await getConnectedAccount(ctx.connectedAccountId)
        for (let attempt = 1; account.status !== 'ACTIVE' && account.status !== 'FAILED' && attempt < ACTIVE_POLL_ATTEMPTS; attempt++) {
            await sleep(ACTIVE_POLL_DELAY_MS)
            account = await getConnectedAccount(ctx.connectedAccountId)
        }
        if (account.userId !== userId || account.authConfigId !== authConfigId) {
            console.warn(`[composio] connected account ${ctx.connectedAccountId} does not match the pending context`)
            return finish({ ok: false, error: 'Connection mismatch, please retry' })
        }
        if (account.status !== 'ACTIVE') {
            return finish({ ok: false, error: `Connection is not active yet (${account.status}). Please retry.` })
        }

        if (grant) {
            await parkSignIn(grant, { kind: 'composio', key: ctx.key, connectedAccountId: ctx.connectedAccountId })
            return finish({ ok: true, claim: grant.jti })
        }
        await markComposioAuthorized(ctx.agentId, ctx.key, ctx.connectedAccountId, undefined, actor)
        return finish({ ok: true })
    } catch (err) {
        return finish({ ok: false, error: err instanceof Error ? err.message : 'Authorization failed' })
    }
}
