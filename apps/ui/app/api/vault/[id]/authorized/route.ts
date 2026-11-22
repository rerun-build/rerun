import { claimParkedSignIn } from '@/app/api/_services/oauth-claim.service'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { ApiError } from '@/lib/api-error'
import { getVaultItem, putVaultToken } from '@/lib/engine/vault-client'
import { AppError, refusal } from '@/lib/i18n/action-error'
import { engineClientSecret } from '@/lib/mcp-oauth'
import { signInClaimSchema } from '@rerun/contracts'
import { NextResponse } from 'next/server'
import { refusalResponse } from '../../_lib/refusal-response'

// The token the callback parked for the desktop app, claimed by the member who started the sign-in,
// lands on the entry it was started for. The entry turns active through the Vault's own action after.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { claim } = signInClaimSchema.parse(await req.json())
        const { actor, conn } = await vaultContext()
        await assertCanAdd(actor)
        if (actor.kind !== 'user') throw new AppError('authorizationFailed')
        const item = await getVaultItem(conn, id)
        const parked = await claimParkedSignIn(claim, { agentId: '', workspaceId: actor.workspaceId, userId: actor.userId })
        if (parked.kind !== 'mcp' || !item.oauth || parked.serverName !== item.oauth.serverName || parked.mcpUrl !== item.oauth.url) throw new ApiError(409, refusal('signInForAnotherServer'))
        await putVaultToken(conn, item.id, parked.serverName, { ...parked.token, clientSecret: engineClientSecret({ mcpUrl: item.oauth.url, clientId: parked.token.clientId, clientSecret: parked.token.clientSecret }) })
        return new NextResponse(null, { status: 204 })
    } catch (err) {
        return refusalResponse(err, 'authorizationFailed')
    }
}
