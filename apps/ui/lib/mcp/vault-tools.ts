// The Vault half of the account server: the accounts, secrets and MCP servers the workspace keeps
// once and lends to its coworkers. Same audience and same rule as account-tools.ts: these
// descriptions are the only documentation the calling model gets. What every tool here shares: no
// value ever comes out of the Vault and none goes in, so signing an entry in or typing its
// credentials stays in the Rerun app.
export const VAULT_TOOL_DEFS = [
    {
        name: 'list_vault',
        description:
            "The workspace's Vault: every app account, custom MCP server and secret it keeps once for its coworkers, and the paid app accounts (LinkedIn Pro, WhatsApp Pro). Each entry says whether it works (`status`: \"active\", \"needs_auth\" waiting for a sign-in, \"needs_config\" waiting for a credential), which coworkers hold it, or `sharedWithAll` when every coworker does, and `canChange` when this key may change it. Coworkers this key cannot see are only counted in `hiddenCoworkers`. `coworkers` lists the ones it can see, with `canManage` when it may lend them an entry. No value, variable name or token ever comes out. Signing an entry in and typing its credentials happen in the Rerun app (workspace menu, Vault), never here: add_vault_entry adds an app or a custom MCP server without any. A workspace whose machine keeps no Vault answers available: false; its apps are then connected coworker by coworker with attach_connector.",
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'add_vault_entry',
        description:
            'Add an entry to the Vault, lent at once to the coworkers you name, or to every coworker. kind "app" adds an app of the Rerun library by its slug (from search_connectors); kind "mcp" adds a custom MCP server, by its https address or by the command the machine starts. No credential ever goes through here. The answer is the entry as list_vault shows it: one whose status is needs_auth (a sign-in) or needs_config (a key) waits on the account owner, who finishes it in the Rerun app (workspace menu, Vault); never ask anyone for the credential yourself. A secret, an API key, a custom MCP server that needs a key in a header, and a paid app (LinkedIn Pro, WhatsApp Pro) are added in the app, not here. Lending to a coworker needs Can manage on its Box.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['app', 'mcp'] },
                slug: { type: 'string', description: 'For kind app: the library slug.' },
                name: { type: 'string', description: 'For kind mcp: what people read, like "Company docs".' },
                url: { type: 'string', description: 'For kind mcp: the https address of a remote server.' },
                command: { type: 'string', description: 'For kind mcp: the command the machine starts, instead of a url.' },
                args: { type: 'array', items: { type: 'string' }, description: 'For kind mcp with a command: its arguments.' },
                agentIds: { type: 'array', items: { type: 'string' }, description: 'The coworkers to lend it to, from list_vault. Leave it out to keep it in the Vault for later.' },
                sharedWithAll: { type: 'boolean', description: 'True to give it to every coworker, including the ones added later. Admins only.' },
            },
            required: ['kind'],
        },
    },
    {
        name: 'attach_vault_entry',
        description:
            'Lend a Vault entry to one coworker: an app account already signed in, a custom MCP server or a secret, so it never has to be connected twice. Works for the paid app accounts too: one joins the other accounts of the app the coworker already has. Needs Can manage on the coworker\'s Box. A coworker cannot get the same variable or server name from two entries: the call is refused, naming the entry it clashes with. Returns the entry as list_vault shows it.',
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
        name: 'rename_vault_entry',
        description:
            'Give the account of an app in the Vault a name of its own, like "Acme org" or "Personal", up to 60 characters: it replaces the account line wherever the app is shown, and signing in again keeps it. Pass name null to give it back the name its sign-in reported. Only an app account is renamed, not a secret, a custom MCP server or a paid app account. Needs the right to change the entry (canChange in list_vault). Returns the entry as list_vault shows it.',
        inputSchema: {
            type: 'object',
            properties: {
                entryId: { type: 'string', description: 'The id of an app entry, from list_vault.' },
                name: { type: ['string', 'null'], maxLength: 60 },
            },
            required: ['entryId', 'name'],
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
