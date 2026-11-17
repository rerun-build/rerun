// The Vault half of the account server: the accounts, secrets and MCP servers the workspace keeps
// once and lends to its coworkers. Same audience and same rule as account-tools.ts: these
// descriptions are the only documentation the calling model gets. What every tool here shares: no
// value ever comes out of the Vault and none goes in, so adding an entry or typing its credentials
// stays in the Rerun app.
export const VAULT_TOOL_DEFS = [
    {
        name: 'list_vault',
        description:
            "The workspace's Vault: every app account, custom MCP server and secret it keeps once for its coworkers, and the paid app accounts (LinkedIn Pro, WhatsApp Pro). Each entry says whether it works (`status`: \"active\", \"needs_auth\" waiting for a sign-in, \"needs_config\" waiting for a credential), which coworkers hold it, or `sharedWithAll` when every coworker does, and `canChange` when this key may change it. Coworkers this key cannot see are only counted in `hiddenCoworkers`. `coworkers` lists the ones it can see, with `canManage` when it may lend them an entry. No value, variable name or token ever comes out. Adding an entry, signing it in and typing its credentials happen in the Rerun app (workspace menu, Vault), never here. A workspace whose machine keeps no Vault answers available: false; its apps are then connected coworker by coworker with attach_connector.",
        inputSchema: { type: 'object', properties: {} },
    },
] as const
