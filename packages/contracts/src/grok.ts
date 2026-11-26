// The sign-in Grok Build, xAI's own coding agent, uses: its public OAuth client (no secret) on
// xAI's authorization server. Rerun signs a Grok subscription in the same way, with a device code,
// and the engine keeps the tokens fresh against the same server. Fixed here, never read off a
// discovery document or a response: no address that came back from a server is ever followed.
export const GROK_AUTH_ORIGIN = 'https://auth.x.ai'
export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
