import { loadManifest, markComposioAuthorized } from '@/app/api/_services/services.service'
import { assertVaultComposioAccount, connectVaultComposio, discardVaultComposioAccount, vaultSignInContext } from '@/app/api/_services/vault-sign-in.service'
import { vaultContext } from '@/app/api/_services/vault.service'
import { assertConnectedAccount } from '@/lib/composio/connected-account'
import { composioUserForKey } from '@/lib/vault/composio'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, decodeComposioContext } from '@/lib/composio/oauth'
import { oauthPopupResponse, popupFailureLabel, popupSuccessLabel } from '@/lib/oauth/popup-result'
import { refusal, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { callbackGrant, type CallbackGrant } from '@/lib/oauth/mobile-ticket'
import { holdsParkedSignIn, parkSignIn } from '@/lib/oauth/pending-grant'
import { requireAgentWorkspaceId, workspaceActor } from '@/app/api/_auth/access'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { DesktopShellChannel } from '@rerun/contracts'

type CallbackResult = { ok: true; accountLabel?: string; claim?: string } | ({ ok: false } & ActionRefusal)

// `key` lets a page holding several Connect buttons of one app tell which account just finished.
// It is absent when the context could not be read, so every listener still hears that failure.
async function htmlResult(result: CallbackResult, key?: string): Promise<NextResponse> {
    const target = key ? { key } : {}
    if (result.ok) {
        return oauthPopupResponse({
            channel: 'composio-oauth',
            message: { type: 'composio-oauth-success', ...target, accountLabel: result.accountLabel },
            label: await popupSuccessLabel(result.accountLabel),
        })
    }
    const { ok: _ok, ...failure } = result
    return oauthPopupResponse({ channel: 'composio-oauth', message: { type: 'composio-oauth-error', ...target, ...failure }, label: await popupFailureLabel(failure) })
}

// Composio redirect target after the user completes the hosted sign-in. The query params are
// NOT trusted for authorization: the account id comes from the /start cookie, and the server
// re-fetches it from Composio to prove it belongs to the expected user_id + auth config and
// is ACTIVE, before flipping the registry entry. No engine token — Composio holds it.
export async function GET(req: Request) {
    const url = new URL(req.url)
    const state = url.searchParams.get('state')
    if (!state) return htmlResult({ ok: false, ...refusal('missingState') })

    const cookieName = COMPOSIO_COOKIE_PREFIX + state
    const raw = (await cookies()).get(cookieName)?.value

    // Only known once the context is decoded, and `finish` is what every exit path goes through.
    let mobile = false
    // The desktop app's channel, when it started the sign-in: where the browser goes back to.
    let desktop: DesktopShellChannel | undefined
    let key: string | undefined

    const finish = async (result: CallbackResult): Promise<NextResponse> => {
        const res = mobile ? new NextResponse(null, { status: 302, headers: { Location: appReturnUrl(result, desktop) } }) : await htmlResult(result, key)
        res.cookies.delete({ name: cookieName, path: COMPOSIO_COOKIE_PATH })
        return res
    }

    if (!raw) return finish({ ok: false, ...refusal('oauthSessionExpired') })

    // Decoded before the status check below so a refused sign-in also lands back in the app.
    let ctx: ComposioOAuthContext
    try {
        ctx = decodeComposioContext(raw)
        key = ctx.key
    } catch {
        return finish({ ok: false, ...refusal('oauthSessionExpired') })
    }
    mobile = ctx.mobileGrant !== undefined

    const status = url.searchParams.get('status')
    if (status && status !== 'success') {
        const detail = url.searchParams.get('error') ?? url.searchParams.get('error_description')
        console.warn('[composio] authorize rejected:', Object.fromEntries(url.searchParams))
        return finish({ ok: false, error: detail ?? `Connection ${status}` })
    }

    let grant: CallbackGrant | undefined
    try {
        grant = callbackGrant(ctx)
        desktop = grant?.desktop
        if (ctx.vault) {
            // From the desktop app, the sign-in ends in the system browser, which has no session: the
            // checked account waits under the grant for the app to claim it with its own.
            if (grant) {
                await assertVaultComposioAccount(await vaultContext(workspaceActor(grant.workspaceId)), ctx.vault.itemId, ctx.connectedAccountId)
                await parkSignIn(grant, { kind: 'composio', key: ctx.key, connectedAccountId: ctx.connectedAccountId })
                return finish({ ok: true, claim: grant.jti })
            }
            await connectVaultComposio(await vaultSignInContext(ctx.vault.workspaceId), ctx.vault.itemId, ctx.connectedAccountId)
            return finish({ ok: true })
        }
        const workspaceId = grant?.workspaceId ?? (await requireAgentWorkspaceId(ctx.agentId, 'manage', ctx.workspaceId))
        // The session passed `manage` on the coworker's Box just above, or the grant was minted for someone who did.
        const actor = workspaceActor(workspaceId)
        const { conn, engineAgentId } = await resolveAgentTarget(ctx.agentId, 'manage', actor)
        const userId = await composioUserForKey(conn, workspaceId, engineAgentId, ctx.agentId, ctx.key)
        const method = (await loadManifest(ctx.key))?.authMethods.find(m => m.kind === 'composio' && m.composio)
        if (!method?.composio) return finish({ ok: false, ...refusal('noProviderConnectionToSetUp', { key: ctx.key, provider: 'Composio' }) })
        await assertConnectedAccount(ctx.connectedAccountId, { userId, authConfigId: method.composio.authConfigId })

        if (grant) {
            await parkSignIn(grant, { kind: 'composio', key: ctx.key, connectedAccountId: ctx.connectedAccountId })
            return finish({ ok: true, claim: grant.jti })
        }
        await markComposioAuthorized(ctx.agentId, ctx.key, ctx.connectedAccountId, undefined, actor)
        return finish({ ok: true })
    } catch (err) {
        // A callback the browser sent twice: the first one parked the account, which its claim comes for.
        if (ctx.vault && !(grant && (await holdsParkedSignIn(grant.jti)))) await discardVaultComposioAccount({ ...ctx.vault, connectedAccountId: ctx.connectedAccountId })
        return finish({ ok: false, ...refusalOf(err, 'authorizationFailed') })
    }
}
