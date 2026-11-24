import { claimParkedSignIn } from '@/app/api/_services/oauth-claim.service'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { connectVaultComposio, connectVaultManaged, discardVaultComposioAccount } from '@/app/api/_services/vault-sign-in.service'
import { ApiError } from '@/lib/api-error'
import { getVaultItem, putVaultToken } from '@/lib/engine/vault-client'
import { AppError, refusal } from '@/lib/i18n/action-error'
import { engineClientSecret } from '@/lib/mcp-oauth'
import { signInClaimSchema } from '@rerun/contracts'
import { NextResponse } from 'next/server'
import { refusalResponse } from '../../_lib/refusal-response'

// The token the callback parked for the desktop app, claimed by the member who started the sign-in,
// lands on the entry it was started for. An MCP sign-in turns it active through the Vault's own action
// after, a managed or Composio one right here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { claim } = signInClaimSchema.parse(await req.json())
        const ctx = await vaultContext()
        const { actor, conn } = ctx
        await assertCanAdd(actor)
        if (actor.kind !== 'user') throw new AppError('authorizationFailed')
        const item = await getVaultItem(conn, id)
        const parked = await claimParkedSignIn(claim, { agentId: '', workspaceId: actor.workspaceId, userId: actor.userId })
        // The row names the entry it was parked for: it never connects another one of the workspace.
        if (parked.kind === 'composio') {
            try {
                if (parked.key !== item.id) throw new ApiError(409, refusal('signInForAnotherServer'))
                await connectVaultComposio(ctx, item.id, parked.connectedAccountId)
            } catch (err) {
                // The row is spent: no other claim can finish this sign-in.
                await discardVaultComposioAccount({ workspaceId: actor.workspaceId, itemId: parked.key, connectedAccountId: parked.connectedAccountId })
                throw err
            }
            return new NextResponse(null, { status: 204 })
        }
        if (parked.kind === 'managed' && parked.key === item.id) {
            await connectVaultManaged(ctx, item.id, parked.provider, parked.token, parked.email)
            return new NextResponse(null, { status: 204 })
        }
        if (parked.kind !== 'mcp' || !item.oauth || parked.serverName !== item.oauth.serverName || parked.mcpUrl !== item.oauth.url) throw new ApiError(409, refusal('signInForAnotherServer'))
        await putVaultToken(conn, item.id, parked.serverName, { ...parked.token, clientSecret: engineClientSecret({ mcpUrl: item.oauth.url, clientId: parked.token.clientId, clientSecret: parked.token.clientSecret }) })
        return new NextResponse(null, { status: 204 })
    } catch (err) {
        return refusalResponse(err, 'authorizationFailed')
    }
}
