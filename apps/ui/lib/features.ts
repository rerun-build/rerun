// Tant qu'une feature n'est pas lancée, son flag limite l'accès anticipé.
// Passer la constante à `true` la rend à tout le monde et réveille ce qui va avec.
export const REWIND_RELEASED = false
// Gates the Desktop button of the agent sheet. What an agent does with its screen (the computer
// tools, a takeover asked in its chat) is gated by DESKTOP_RELEASED on the engine.
export const COMPUTER_RELEASED = true
// Gates LinkedIn Pro, the first paid app: its card in the catalogue, its slots in the billing and
// every server action that connects an account or buys a slot.
export const LINKEDIN_PRO_RELEASED = true
// Gates WhatsApp Pro, the second paid app, like LINKEDIN_PRO_RELEASED gates the first.
export const WHATSAPP_PRO_RELEASED = true
// Gates the access settings of published links (the share dialog, the Published views, the
// workspace policy). Before it, a workspace that never picked a policy publishes everything
// public, as it always did.
export const PUBLISHED_ACCESS_RELEASED = true
// Gates OpenCode as an AI provider: listed, and accepted on creation, only with it on and on a machine
// whose engine reports the `connections.opencode` capability. Off by default; `NEXT_PUBLIC_OPENCODE_ENABLED=1`
// turns it on for a local stack or a deploy.
export const OPENCODE_ENABLED = process.env.NEXT_PUBLIC_OPENCODE_ENABLED === '1'
// Gates the language packs: until it flips, everyone outside the early access reads English and the
// language pickers stay hidden, whatever their browser or their saved choice asks for.
export const I18N_RELEASED = true
// Gates the workspace's Vault: its entry in the workspace menu, and new connectors going into it
// rather than into each coworker's folder. Until it flips, only the early access sees it, and a box
// without the engine's `vault` capability keeps every connector per coworker whatever it says.
// `NEXT_PUBLIC_VAULT_ENABLED=1` turns it on for a local stack or a staging deploy.
export const VAULT_RELEASED = process.env.NEXT_PUBLIC_VAULT_ENABLED === '1'
// Gates the Simple view, the list of coworkers beside the chat offered next to the 3D board. Until it
// flips, only the early access sees the switch; the board stays everyone's default either way.
export const SIMPLE_VIEW_RELEASED = false
