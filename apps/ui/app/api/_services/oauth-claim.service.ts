import 'server-only'
import type { Actor } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { markComposioAuthorized, markManagedAuthorized, markServiceAuthorized } from '@/app/api/_services/services.service'
import { ApiError } from '@/lib/api-error'
import { putConnectorToken } from '@/lib/vault/tokens'
import { managedTokenBundle } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { engineClientSecret } from '@/lib/mcp-oauth'
import { claimSignIn, SIGN_IN_EXPIRED, SignInClaimError, type ParkedSignIn } from '@/lib/oauth/pending-grant'
import { refusal } from '@/lib/i18n/action-error'
import { discardVaultComposioAccount } from './vault-sign-in.service'

type Claimant = { agentId: string; workspaceId: number; userId: string }

export async function claimParkedSignIn(claim: string, claimant: Claimant): Promise<ParkedSignIn> {
    try {
        return await claimSignIn(claim, claimant)
    } catch (err) {
        if (!(err instanceof SignInClaimError)) throw err
        if (err.abandoned) await discardVaultComposioAccount(err.abandoned)
        throw new ApiError(409, err.message === SIGN_IN_EXPIRED ? refusal('signInExpired') : err.message)
    }
}

// The engine write the callback left to the app: the same bundle and the same registry flip the web
// callback does, once the person who started the sign-in asked for it with their bearer. A catalog
// service reached through a plain MCP sign-in is flipped by its route, which knows the key.
export async function finishParkedSignIn(agentId: string, actor: Actor, parked: ParkedSignIn): Promise<void> {
    if (parked.kind === 'composio') {
        await markComposioAuthorized(agentId, parked.key, parked.connectedAccountId, undefined, actor)
        return
    }
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, 'manage', actor)
    if (parked.kind === 'mcp') {
        const clientSecret = parked.mcpUrl ? engineClientSecret({ mcpUrl: parked.mcpUrl, clientId: parked.token.clientId, clientSecret: parked.token.clientSecret }) : parked.token.clientSecret
        await putConnectorToken(conn, engineAgentId, parked.serverName, { ...parked.token, clientSecret })
        return
    }
    const provider = getManagedProvider(parked.provider)
    if (!provider) throw new Error(`${parked.provider} is not configured on this server.`)
    await putConnectorToken(conn, engineAgentId, parked.serverName, managedTokenBundle(provider, parked.token))
    await markManagedAuthorized(agentId, parked.key, parked.email, actor)
}

export { markServiceAuthorized }
