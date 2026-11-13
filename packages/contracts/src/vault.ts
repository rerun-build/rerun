import { z } from 'zod'
import { MCP_SERVER_NAME_RE, mcpServerSchema, strictMcpServerSchema } from './agent.js'

// The workspace's Vault: an account signed in once (or a key typed once) on the box, then attached
// to the coworkers that use it. The secret half of an item (its `.env` and its OAuth tokens) never
// leaves the box: nothing below carries a value, only the names of what is stored.

export const vaultItemKindSchema = z.enum(['service', 'mcp', 'secret'])
export type VaultItemKind = z.infer<typeof vaultItemKindSchema>

export const vaultItemStatusSchema = z.enum(['active', 'needs_config', 'needs_auth'])
export type VaultItemStatus = z.infer<typeof vaultItemStatusSchema>

export const VAULT_ITEM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// The variable a free secret is read under, in a shell and in a `${VAR}` alike.
export const VAULT_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
export const vaultEnvKeySchema = z.string().regex(VAULT_ENV_KEY_RE, 'must start with a letter or an underscore, then letters, digits or underscores')

// A connector skill, owned by the item and written into the folder of every coworker it is attached
// to: the instructions that tell the model how to use the app's tools.
export const vaultSkillSchema = z.object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().min(1),
    description: z.string().default(''),
    body: z.string().min(1),
})
export type VaultSkill = z.infer<typeof vaultSkillSchema>

// The sign-in an item waits on or was made with, the same four flows a coworker's own connector
// records. Only names and labels: the token itself is under `tokens/`, or at Composio.
export const vaultOAuthSchema = z.object({ serverName: z.string(), url: z.string() })
export const vaultManagedSchema = z.object({ provider: z.string(), serverName: z.string(), accountEmail: z.string().optional() })
export const vaultComposioSchema = z.object({
    toolkit: z.string(),
    serverName: z.string(),
    connectedAccountId: z.string().optional(),
    accountLabel: z.string().optional(),
    // The Composio user the account was connected under. An item migrated from a coworker keeps
    // the id that coworker connected it with, so nobody has to sign in again.
    userId: z.string().optional(),
})
export const vaultAppSchema = z.object({ appSlug: z.string(), serverName: z.string(), accountLabel: z.string().optional() })

const itemFields = {
    kind: vaultItemKindSchema,
    // The catalog app an item installs; null for a custom MCP server and a free secret.
    slug: z.string().min(1).nullable().default(null),
    name: z.string().trim().min(1).max(120),
    // Which account this is, for people and coworkers alike: an email, a workspace name, "Gmail 2".
    label: z.string().trim().max(200).optional(),
    status: vaultItemStatusSchema.default('active'),
    authMethodId: z.string().optional(),
    // The non-secret inputs of the install form, kept so a reconfigure opens filled in.
    config: z.record(z.string(), z.string()).default({}),
    mcpServers: z.array(mcpServerSchema).default([]),
    skills: z.array(vaultSkillSchema).default([]),
    oauth: vaultOAuthSchema.optional(),
    managed: vaultManagedSchema.optional(),
    composio: vaultComposioSchema.optional(),
    app: vaultAppSchema.optional(),
    // Set on an extra account of an app: it suffixes the item's server names and variables, so a
    // second Gmail never collides with the first one on a coworker holding both.
    instanceId: z.string().optional(),
}

// `item.json`. `agentIds` are the box's own agent ids, the coworkers attached to the item. Kept as is
// when the item is shared with everyone, so going back to a selection restores the one it had.
export const vaultItemConfigSchema = z.object({
    ...itemFields,
    agentIds: z.array(z.string()).default([]),
    sharedWithAll: z.boolean().default(false),
    // The hub user who added it. Null for an item the box created on its own (a migration).
    createdBy: z.string().nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
})
export type VaultItemConfig = z.infer<typeof vaultItemConfigSchema>

// What any read of an item hands out: its config, and the names of what it stores, never a value.
export const vaultItemSummarySchema = vaultItemConfigSchema.extend({
    id: z.string(),
    envKeys: z.array(z.string()),
    // The servers that hold an OAuth token, and those whose token can no longer be refreshed.
    tokens: z.array(z.string()),
})
export type VaultItemSummary = z.infer<typeof vaultItemSummarySchema>

const strictServers = z
    .array(strictMcpServerSchema)
    .refine(servers => new Set(servers.map(server => server.name)).size === servers.length, 'two servers of one item cannot share a name')

const envRecord = z.record(vaultEnvKeySchema, z.string())

export const createVaultItemSchema = z.object({
    ...itemFields,
    mcpServers: strictServers.default([]),
    agentIds: z.array(z.string()).default([]),
    sharedWithAll: z.boolean().default(false),
    createdBy: z.string().nullable().default(null),
    env: envRecord.default({}),
})
export type CreateVaultItemInput = z.input<typeof createVaultItemSchema>

// Everything but the kind, the attachments and the stored secrets, which have routes of their own.
export const updateVaultItemSchema = z
    .object({
        slug: itemFields.slug.unwrap().unwrap().nullable(),
        name: itemFields.name,
        label: z.string().trim().max(200).nullable(),
        status: vaultItemStatusSchema,
        authMethodId: z.string().nullable(),
        config: z.record(z.string(), z.string()),
        mcpServers: strictServers,
        skills: z.array(vaultSkillSchema),
        oauth: vaultOAuthSchema.nullable(),
        managed: vaultManagedSchema.nullable(),
        composio: vaultComposioSchema.nullable(),
        app: vaultAppSchema.nullable(),
        sharedWithAll: z.boolean(),
    })
    .partial()
export type UpdateVaultItemInput = z.infer<typeof updateVaultItemSchema>

export const updateVaultItemEnvSchema = z.object({
    set: envRecord.default({}),
    remove: z.array(z.string()).default([]),
})
export type UpdateVaultItemEnvInput = z.input<typeof updateVaultItemEnvSchema>

// The coworkers that lose an item if it goes: the attached ones, or every one when it is shared.
export const vaultItemUsageSchema = z.object({ agentIds: z.array(z.string()) })
export type VaultItemUsage = z.infer<typeof vaultItemUsageSchema>

export const vaultDeleteResultSchema = z.object({ deleted: z.string(), detached: z.array(z.string()) })
export type VaultDeleteResult = z.infer<typeof vaultDeleteResultSchema>

// Why an attachment was refused: the coworker would hold two values for one variable, two servers
// under one name or two skills under one slug, and nothing could tell which one it meant. `agentId`
// is `*` when two items shared with everyone clash, whoever the coworkers are.
export const vaultConflictSchema = z.object({
    error: z.string(),
    conflicts: z.array(
        z.object({
            agentId: z.string(),
            itemId: z.string(),
            kind: z.enum(['env', 'server', 'skill']),
            name: z.string(),
        }),
    ),
})
export type VaultConflict = z.infer<typeof vaultConflictSchema>

// What a read of an item shows in place of a header or a server variable written as a literal value
// rather than a `${VAR}`: a key pasted into a custom server's headers is as secret as one in `.env`.
// A write carrying it back is refused, so a round trip can never store the mask over the value.
export const VAULT_REDACTED = '•••'

export function redactVaultValue(value: string): string {
    return value === '' || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) || /^Bearer \$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) ? value : VAULT_REDACTED
}

export const isVaultItemId = (value: string): boolean => VAULT_ITEM_ID_RE.test(value)
export const isMcpServerName = (value: string): boolean => MCP_SERVER_NAME_RE.test(value)
