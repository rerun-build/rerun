import { memberActor, requireAgentWorkspaceId, workspaceActor } from '@/app/api/_auth/access'
import { UnauthenticatedError } from '@/app/api/_auth/errors'
import { claimParkedSignIn, finishParkedSignIn } from '@/app/api/_services/oauth-claim.service'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { getVaultItem, putVaultToken } from '@/lib/engine/vault-client'
import { AppError, refusal, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'
import { engineClientSecret } from '@/lib/mcp-oauth'
import { forgetNonce, openHostResult, type HostReturn } from '@/lib/oauth/host-sign-in'
import type { ParkedSignIn } from '@/lib/oauth/pending-grant'
import { oauthPopupResponse, popupFailureLabel } from '@/lib/oauth/popup-result'
import { requestOrigin } from '@/lib/request-host'
import { getSessionIdentity } from '@/supabase/session/getServerSession'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Finished = { ok: true; email?: string } | ({ ok: false } & ActionRefusal)

// What the page that opened the popup listens for, whichever flow it was.
async function popup(result: Finished, target?: HostReturn['target']): Promise<NextResponse> {
    const channel = target?.flow === 'mcp' ? 'mcp-oauth' : 'managed-oauth'
    const named = !target ? {} : target.flow === 'mcp' ? { serverName: target.serverName } : { key: target.key }
    if (result.ok) {
        const email = result.email ? { email: result.email } : {}
        return oauthPopupResponse({ channel, message: { type: `${channel}-success`, ...named, ...email }, label: `Connected${result.email ? ` as ${result.email}` : ''}. You can close this window.` })
    }
    const { ok: _ok, ...failure } = result
    return oauthPopupResponse({ channel, message: { type: `${channel}-error`, ...named, ...failure }, label: await popupFailureLabel(failure) })
}

// The token of a Vault entry no coworker may hold yet goes to the entry, if it is still that server's.
async function finishForVault(back: HostReturn, vaultItem: string, parked: ParkedSignIn): Promise<void> {
    const actor = await memberActor(back.workspaceId, back.userId)
    if (!actor) throw new AppError('signInOtherWorkspace')
    const { conn } = await vaultContext(actor)
    await assertCanAdd(actor)
    const item = await getVaultItem(conn, vaultItem)
    if (parked.kind !== 'mcp' || !item.oauth || parked.serverName !== item.oauth.serverName || parked.mcpUrl !== item.oauth.url) throw new AppError('signInForAnotherServer')
    await putVaultToken(conn, item.id, parked.serverName, { ...parked.token, clientSecret: engineClientSecret({ mcpUrl: item.oauth.url, clientId: parked.token.clientId, clientSecret: parked.token.clientSecret }) })
}

async function finish(back: HostReturn, claim: string): Promise<Finished> {
    // The person who started it, still signed in on this host, and still allowed to connect it.
    const identity = await getSessionIdentity()
    if (identity?.id !== back.userId) throw new UnauthenticatedError()
    const { agentId, workspaceId, userId, target } = back
    const vaultItem = target.flow === 'mcp' ? target.vaultItem : undefined
    if (vaultItem === undefined) await requireAgentWorkspaceId(agentId, 'manage', workspaceId)

    const parked = await claimParkedSignIn(claim, { agentId, workspaceId, userId })
    if (vaultItem !== undefined) await finishForVault(back, vaultItem, parked)
    else await finishParkedSignIn(agentId, workspaceActor(workspaceId), parked)
    return { ok: true, email: parked.kind === 'managed' ? parked.email : undefined }
}

// Where a sign-in started on an organization's address ends, once the provider sent the browser back
// to Rerun's and Rerun's back here.
export async function GET(req: Request) {
    const cookieStore = await cookies()
    let back: HostReturn | undefined
    try {
        const result = openHostResult(new URL(req.url).searchParams.get('r'), requestOrigin(req.headers), name => cookieStore.get(name)?.value)
        back = result.back
        const { outcome } = result
        return forgetNonce(await popup(outcome.ok ? await finish(back, outcome.claim) : outcome, back.target), back)
    } catch (err) {
        const failure = back ? refusalOf(err, 'authorizationFailed') : refusal('signInExpired')
        const res = await popup({ ok: false, ...failure }, back?.target)
        return back ? forgetNonce(res, back) : res
    }
}
