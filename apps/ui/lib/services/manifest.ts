import { inputDefSchema, mcpServerNameSchema, SERVICE_CATEGORIES, type InputDef } from '@rerun/contracts'
import { z } from 'zod'

// A Service is a UI-only concept. Its manifest is the single source of truth for:
//   - the install form rendered identically in the agent settings panel AND in chat
//   - the compiler that turns it into engine primitives (mcpServers, .env keys, skills)
// The manifest is stored as JSONB in the `services.manifest` column and validated on read.
// Secrets collected via `inputs` go to the engine .env / mcp config — never to Supabase.

// The install-form field lives in @rerun/contracts so templates can describe the very
// same "value the user must supply" without depending on apps/ui.
export { inputDefSchema, inputOptionSchema, type InputDef, type InputOption } from '@rerun/contracts'

// Marks an mcp server that authenticates via browser OAuth (authorization-code + PKCE)
// instead of a pasted credential. The user signs in through a popup; the resulting token
// is stored in the engine token store (never in Supabase) and injected at connect time.
// Endpoints are discovered from the server at connect — only overrides live here.
export const mcpOAuthSchema = z.object({
    scopes: z.array(z.string()).optional(),
    // Fallback client id for providers without Dynamic Client Registration.
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    // Override the discovered authorization server if the well-known lookup is insufficient.
    authorizationServer: z.string().optional(),
})
export type McpOAuth = z.infer<typeof mcpOAuthSchema>

// Mirrors the engine's mcpServerSchema, but url/headers/env/args/command may contain
// `${input.KEY}` placeholders substituted from the user's input values at compile time.
export const mcpServerTemplateSchema = z.object({
    name: mcpServerNameSchema,
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).default({}),
    headers: z.record(z.string(), z.string()).default({}),
    oauth: mcpOAuthSchema.optional(),
})
export type McpServerTemplate = z.infer<typeof mcpServerTemplateSchema>

// Behavioural instructions are delivered as engine skills (POST /agents/:id/skills),
// not as soul fragments — this keeps the engine untouched.
export const serviceSkillSchema = z.object({
    name: z.string(),
    description: z.string().default(''),
    body: z.string(),
})
export type ServiceSkill = z.infer<typeof serviceSkillSchema>

// Maps an input value to an engine .env variable (for secrets that the MCP server or
// an installed package reads from the environment rather than from a header).
export const envKeyMappingSchema = z.object({
    key: z.string(),
    fromInput: z.string(),
})
export type EnvKeyMapping = z.infer<typeof envKeyMappingSchema>

// A managed service authenticates via Rerun's own OAuth client (one app for everyone) and
// proxies its API calls through Rerun (/api/mcp/managed/<provider>). The user just signs in;
// no developer console, no pasted credential. `provider` selects the Rerun-side provider
// (lib/managed/registry.ts) that owns the OAuth config + toolset.
export const managedSchema = z.object({
    provider: z.string(),
})
export type Managed = z.infer<typeof managedSchema>

// A composio service authenticates via Composio (which holds the third-party token) and
// proxies its tool calls through Rerun (/api/mcp/composio/<slug>), scoped by a server-derived
// per-agent user_id. `authConfigId` selects the Composio auth config (OAuth app + scopes) for
// the toolkit; `allowedTools` optionally trims the toolkit's tool list.
export const composioSchema = z.object({
    toolkit: z.string(),
    authConfigId: z.string(),
    allowedTools: z.array(z.string()).optional(),
})
export type Composio = z.infer<typeof composioSchema>

// A paid Rerun app (LinkedIn Pro first): the account belongs to the workspace and is billed by the
// slot, the coworker picks which connected account it acts with, and its tool calls go through
// Rerun (/api/mcp/apps/<appSlug>).
export const appSchema = z.object({
    appSlug: z.string(),
})
export type AppRef = z.infer<typeof appSchema>

// One way to authenticate a service. A service can offer several (e.g. OAuth sign-in OR a
// pasted API key), each carrying its OWN inputs/mcpServers/envKeys — the user picks one at
// install time. `kind` makes the auth model explicit (drives the UI: Connect vs Install)
// without leaking the mcpServers to the client. Shared behavioural skills stay top-level.
export const authMethodSchema = z.object({
    id: z.string(),
    label: z.string().default(''),
    kind: z.enum(['oauth', 'key', 'stdio', 'none', 'managed', 'composio', 'app']).default('key'),
    recommended: z.boolean().default(false),
    inputs: z.array(inputDefSchema).default([]),
    mcpServers: z.array(mcpServerTemplateSchema).default([]),
    envKeys: z.array(envKeyMappingSchema).default([]),
    managed: managedSchema.optional(),
    composio: composioSchema.optional(),
    app: appSchema.optional(),
})
export type AuthMethod = z.infer<typeof authMethodSchema>

export { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, type ServiceCategory } from '@rerun/contracts'

// Infer the auth `kind` of a legacy flat manifest (or a method built from one) from its
// shape — the same derivation the code used before auth methods existed.
function deriveKind(m: { inputs: InputDef[]; mcpServers: McpServerTemplate[] }): AuthMethod['kind'] {
    if (m.mcpServers.some(s => s.oauth)) return 'oauth'
    if (m.mcpServers.some(s => s.transport === 'stdio')) return 'stdio'
    if (m.inputs.length > 0 || m.mcpServers.length > 0) return 'key'
    return 'none'
}

// Accepts both the legacy flat shape (inputs/mcpServers/envKeys at the top level) and the
// authMethods[] shape. The transform below normalises either into a canonical form that
// ALWAYS exposes a non-empty authMethods[], so the rest of the code has a single path.
const rawServiceManifestSchema = z.object({
    slug: z.string(),
    name: z.string(),
    category: z.enum(SERVICE_CATEGORIES).default('other'),
    summary: z.string().default(''),
    description: z.string().default(''),
    icon: z.string().optional(),
    inputs: z.array(inputDefSchema).default([]),
    mcpServers: z.array(mcpServerTemplateSchema).default([]),
    envKeys: z.array(envKeyMappingSchema).default([]),
    skills: z.array(serviceSkillSchema).default([]),
    authMethods: z.array(authMethodSchema).default([]),
    // An account connector (Gmail, Notion) a coworker can hold twice, each with its own sign-in.
    // Never set on a paid app: its account belongs to the workspace and is billed by the slot.
    multiInstance: z.boolean().default(false),
})

export const serviceManifestSchema = rawServiceManifestSchema.transform(m => ({
    ...m,
    // A legacy flat manifest becomes a single implicit method carrying its flat fields.
    authMethods:
        m.authMethods.length > 0
            ? m.authMethods
            : [{ id: 'default', label: '', kind: deriveKind(m), recommended: true, inputs: m.inputs, mcpServers: m.mcpServers, envKeys: m.envKeys }],
}))
export type ServiceManifest = z.infer<typeof serviceManifestSchema>

// The method to use when the caller didn't pick one (recommended, else the first).
export function defaultMethod(manifest: ServiceManifest): AuthMethod {
    return manifest.authMethods.find(m => m.recommended) ?? manifest.authMethods[0]
}

// Resolve the method the caller selected by id, falling back to the default.
export function getMethod(manifest: ServiceManifest, id?: string): AuthMethod {
    if (id) return manifest.authMethods.find(m => m.id === id) ?? defaultMethod(manifest)
    return defaultMethod(manifest)
}

// Required inputs the user still has to supply for a method to compile.
export function missingRequiredInputs(method: AuthMethod, values: Record<string, string>): InputDef[] {
    return method.inputs.filter(i => i.required && !values[i.key]?.trim())
}

// Required inputs that are secrets — these can never be auto-supplied (e.g. at agent
// creation time), so they always force a needs_config step.
export function requiredSecretInputs(method: AuthMethod): InputDef[] {
    return method.inputs.filter(i => i.required && i.secret)
}

// The mcp server (if any) that authenticates via browser OAuth. Its presence means the
// method is connected by signing in, not by pasting a credential.
export function oauthServer(method: AuthMethod): McpServerTemplate | undefined {
    return method.mcpServers.find(s => s.oauth)
}

// What declaring this service on an agent will actually leave behind, decided from the
// manifest alone. installServiceSlugs auto-compiles only when there is a single method with
// no required secret, and compileService then lands on needs_auth for an oauth/managed
// method — so anything else waits on the user. Both paths read this, which is what keeps a
// catalog annotation from promising something the install doesn't deliver.
export type InstallOutcome = 'active' | 'needs_auth' | 'needs_config'

export function autoInstallableMethod(manifest: ServiceManifest): AuthMethod | null {
    const onlyMethod = manifest.authMethods.length === 1 ? manifest.authMethods[0] : null
    return onlyMethod && requiredSecretInputs(onlyMethod).length === 0 ? onlyMethod : null
}

export function predictInstall(manifest: ServiceManifest): { outcome: InstallOutcome; reason: string } {
    const method = autoInstallableMethod(manifest)
    if (!method) {
        return {
            outcome: 'needs_config',
            reason:
                manifest.authMethods.length > 1
                    ? 'Several ways to connect this one, so the account owner picks in the Rerun app.'
                    : 'Waiting for a credential the account owner pastes in the Rerun app.',
        }
    }
    if (appTarget(method)) {
        return { outcome: 'needs_auth', reason: 'Installed, but waiting for the account owner to pick which connected account the coworker acts with.' }
    }
    if (oauthServer(method) || managedTarget(method) || composioTarget(method)) {
        return { outcome: 'needs_auth', reason: 'Installed, but waiting for the account owner to sign in from the Rerun app.' }
    }
    return { outcome: 'active', reason: 'Installs on its own, no credential and no sign-in.' }
}

// The managed connection a method sets up (Rerun-brokered OAuth + proxy), if any. The
// serverName is the method's single mcp server — the engine token-store key the sign-in
// writes to and that the proxy's Authorization header is injected from.
export function managedTarget(method: AuthMethod): { provider: string; serverName: string } | null {
    if (method.kind !== 'managed' || !method.managed) return null
    const serverName = method.mcpServers[0]?.name
    if (!serverName) return null
    return { provider: method.managed.provider, serverName }
}

// The Composio connection a method sets up (Composio-brokered OAuth + Rerun proxy), if any.
// No engine token here — Composio holds the credential; `serverName` is kept for parity with
// the other targets and for tracing the mcp server the install compiled.
export function composioTarget(method: AuthMethod): { toolkit: string; serverName: string } | null {
    if (method.kind !== 'composio' || !method.composio) return null
    const serverName = method.mcpServers[0]?.name
    if (!serverName) return null
    return { toolkit: method.composio.toolkit, serverName }
}

// The paid app a method plugs the coworker into, if any. Nothing to sign in per coworker: the
// account is connected once for the workspace, and the coworker only picks one.
export function appTarget(method: AuthMethod): { appSlug: string; serverName: string } | null {
    if (method.kind !== 'app' || !method.app) return null
    const serverName = method.mcpServers[0]?.name
    if (!serverName) return null
    return { appSlug: method.app.appSlug, serverName }
}
