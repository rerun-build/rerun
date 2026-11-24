// Composio connect flow: Composio owns the OAuth leg entirely (its own authorize page and
// token exchange), so unlike lib/managed/oauth.ts there is no PKCE here — our `state` only
// binds the /callback request to the install context stashed in an httpOnly cookie by /start.
//
// Server-only. Import from route handlers.

import { appOrigin } from '@/lib/managed/oauth'
import { base64url } from '@/lib/mcp-oauth'
import { openContext, sealContext } from '@/lib/oauth/context-cookie'
import { randomBytes } from 'node:crypto'

export const COMPOSIO_COOKIE_PREFIX = 'composio_oauth_'
export const COMPOSIO_COOKIE_PATH = '/api/oauth/composio'

export type ComposioOAuthContext = {
    agentId: string
    // Registry key of the entry being connected: the bare slug, or `<slug>@<instanceId>`.
    key: string
    toolkit: string
    serverName: string
    // Known at initiate time: Composio creates the (INITIALIZING) account when the link is
    // issued. The callback re-fetches it and only trusts a verified ACTIVE account.
    connectedAccountId: string
    // The workspace of the tab that started the sign-in. The callback's popup names none, and the
    // Chief of Staff has no row to name its own.
    workspaceId?: number
    // Started from the iOS app: the callback redirects back into it instead of answering with the
    // popup page, and reads the workspace from this signed grant since that browser has no session.
    mobileGrant?: string
    // The Vault entry being connected, with an empty `agentId` and its id as the `key`.
    vault?: { itemId: string; workspaceId: number }
}

export function createComposioState(): string {
    return base64url(randomBytes(24))
}

export function composioCallbackUrl(req: Request, state: string): string {
    return `${appOrigin(req)}${COMPOSIO_COOKIE_PATH}/callback?state=${encodeURIComponent(state)}`
}

export function encodeComposioContext(ctx: ComposioOAuthContext): string {
    return sealContext(ctx)
}

export function decodeComposioContext(raw: string): ComposioOAuthContext {
    return openContext<ComposioOAuthContext>(raw)
}
