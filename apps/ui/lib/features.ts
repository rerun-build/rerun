// Gates OpenCode as an AI provider: listed, and accepted on creation, only with it on and on a machine
// whose engine reports the `connections.opencode` capability. Off by default; `NEXT_PUBLIC_OPENCODE_ENABLED=1`
// turns it on for a local stack or a deploy.
export const OPENCODE_ENABLED = process.env.NEXT_PUBLIC_OPENCODE_ENABLED === '1'
