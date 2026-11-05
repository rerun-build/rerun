import 'server-only'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { markComposioAuthorized, markManagedAuthorized, markServiceAuthorized } from '@/app/api/_services/services.service'
import { ApiError } from '@/lib/api-error'
import { putMcpToken } from '@/lib/engine/client'
import { getManagedProvider } from '@/lib/managed/registry'
import { engineClientSecret } from '@/lib/mcp-oauth'
import { claimSignIn, SignInClaimError, type ParkedSignIn } from '@/lib/oauth/pending-grant'

type Claimant = { agentId: string; workspaceId: number; userId: string }

export async function claimParkedSignIn(claim: string, claimant: Claimant): Promise<ParkedSignIn> {
    try {
        return await claimSignIn(claim, claimant)
    } catch (err) {
        if (err instanceof SignInClaimError) throw new ApiError(409, err.message)
        throw err
    }
}

// The engine write the callback left to the app: the same bundle and the same registry flip the web
// callback does, once the person who started the sign-in asked for it with their bearer. A catalog
// service reached through a plain MCP sign-in is flipped by its route, which knows the key.
export async function finishParkedSignIn(agentId: string, workspaceId: number, parked: ParkedSignIn): Promise<void> {
    if (parked.kind === 'composio') {
        await markComposioAuthorized(agentId, parked.key, parked.connectedAccountId, undefined, workspaceId)
        return
    }
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, workspaceId)
    if (parked.kind === 'mcp') {
        const clientSecret = parked.mcpUrl ? engineClientSecret({ mcpUrl: parked.mcpUrl, clientId: parked.token.clientId, clientSecret: parked.token.clientSecret }) : parked.token.clientSecret
        await putMcpToken(conn, engineAgentId, parked.serverName, { ...parked.token, clientSecret })
        return
    }
    const provider = getManagedProvider(parked.provider)
    const clientId = provider && process.env[provider.oauth.clientIdEnv]
    const clientSecret = provider && process.env[provider.oauth.clientSecretEnv]
    if (!provider || !clientId || !clientSecret) throw new Error(`${parked.provider} is not configured on this server.`)
    await putMcpToken(conn, engineAgentId, parked.serverName, { ...parked.token, tokenEndpoint: provider.oauth.tokenEndpoint, clientId, clientSecret, obtainedAt: Date.now() })
    await markManagedAuthorized(agentId, parked.key, parked.email, workspaceId)
}

export { markServiceAuthorized }
