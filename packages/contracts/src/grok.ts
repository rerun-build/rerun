// The sign-in Grok Build, xAI's own coding agent, uses: its public OAuth client (no secret) on
// xAI's authorization server. Rerun signs a Grok subscription in the same way, with a device code,
// and the engine keeps the tokens fresh against the same server. Fixed here, never read off a
// discovery document or a response: no address that came back from a server is ever followed.
export const GROK_AUTH_ORIGIN = 'https://auth.x.ai'
export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'

// Where the subscription is billed: Grok Build's own proxy, which speaks the Responses API. The
// same token on api.x.ai lands on a small free allowance instead.
export const GROK_PROXY_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'

// The proxy turns away a client older than its `min_client_version` (426) and names the version it
// wants in the refusal: the engine takes that one up for the rest of its life. This is the Grok Build
// release current when this engine was built (`@xai-official/grok`, 2026-11-25).
export const GROK_CLIENT_VERSION = '1.0.92'

// Grok 4.5 takes an image and answers about something else (measured 2026-11-26): it is the one
// model of the plan that cannot see. A model newer than this list is trusted with images.
const GROK_TEXT_ONLY_MODELS: ReadonlySet<string> = new Set(['grok-4.5'])

export function grokSeesImages(model: string): boolean {
    return !GROK_TEXT_ONLY_MODELS.has(model)
}
