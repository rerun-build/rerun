import { appOrigin } from '@/lib/managed/oauth'
import { base64url } from '@/lib/mcp-oauth'
import { openContext, sealContext } from '@/lib/oauth/context-cookie'
import { randomBytes } from 'node:crypto'

export const COMPOSIO_COOKIE_PREFIX = 'composio_oauth_'
export const COMPOSIO_COOKIE_PATH = '/api/oauth/composio'

export type ComposioOAuthContext = {
    agentId: string
    key: string
    toolkit: string
    serverName: string
    connectedAccountId: string
    mobileGrant?: string
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
