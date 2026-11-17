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
    {
        name: 'attach_vault_entry',
        description:
            'Lend a Vault entry to one coworker: an app account already signed in, a custom MCP server or a secret, so it never has to be connected twice. Works for the paid app accounts too. Needs Can manage on the coworker\'s Box. A coworker cannot get the same variable or server name from two entries: the call is refused, naming the entry it clashes with. Returns the entry as list_vault shows it.',
        inputSchema: {
            type: 'object',
            properties: {
                entryId: { type: 'string', description: 'The id of an entry or of a paid account, from list_vault.' },
                agentId: { type: 'string' },
            },
            required: ['entryId', 'agentId'],
        },
    },
    {
        name: 'detach_vault_entry',
        description:
            'Take a Vault entry back from one coworker. The entry stays in the Vault, for the other coworkers and for later. An entry shared with every coworker cannot be taken back from one of them: switch sharedWithAll off with share_vault_entry first. Needs Can manage on the coworker\'s Box. Returns the entry as list_vault shows it.',
        inputSchema: {
            type: 'object',
            properties: {
                entryId: { type: 'string', description: 'The id of an entry or of a paid account, from list_vault.' },
                agentId: { type: 'string' },
            },
            required: ['entryId', 'agentId'],
        },
    },
    {
        name: 'share_vault_entry',
        description:
            "Give a Vault entry to every coworker of the workspace, including the ones added later, or take it back to the coworkers it was switched on for one by one (sharedWithAll: false restores that selection). Admins only. A paid app account is lent coworker by coworker and cannot be shared with everyone. Returns the entry as list_vault shows it.",
        inputSchema: {
            type: 'object',
            properties: {
                entryId: { type: 'string', description: 'The id of an entry, from list_vault.' },
                sharedWithAll: { type: 'boolean' },
            },
            required: ['entryId', 'sharedWithAll'],
        },
    },
    {
        name: 'delete_vault_entry',
        description:
            'Delete a Vault entry for good: every coworker that got it loses it, its credentials are erased and a Composio account behind it is disconnected. Read who loses it in list_vault first and tell the account owner. Admins only. A paid app account has its own subscription and is not deleted here: take it back from coworkers with detach_vault_entry, and end it in the Rerun app. Returns the coworkers that lost it. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: {
                entryId: { type: 'string', description: 'The id of an entry, from list_vault.' },
                confirm: { type: 'boolean' },
            },
            required: ['entryId', 'confirm'],
        },
    },
] as const
