import { inputDefSchema, mcpServerNameSchema, SERVICE_CATEGORIES, type InputDef } from '@moldwright/contracts'
import { z } from 'zod'

export { inputDefSchema, inputOptionSchema, type InputDef, type InputOption } from '@moldwright/contracts'

export const mcpOAuthSchema = z.object({
    scopes: z.array(z.string()).optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    authorizationServer: z.string().optional(),
})
export type McpOAuth = z.infer<typeof mcpOAuthSchema>

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

export const serviceSkillSchema = z.object({
    name: z.string(),
    description: z.string().default(''),
    body: z.string(),
})
export type ServiceSkill = z.infer<typeof serviceSkillSchema>

export const envKeyMappingSchema = z.object({
    key: z.string(),
    fromInput: z.string(),
})
export type EnvKeyMapping = z.infer<typeof envKeyMappingSchema>

export const managedSchema = z.object({
    provider: z.string(),
})
export type Managed = z.infer<typeof managedSchema>

export const composioSchema = z.object({
    toolkit: z.string(),
    authConfigId: z.string(),
    allowedTools: z.array(z.string()).optional(),
})
export type Composio = z.infer<typeof composioSchema>

export const appSchema = z.object({
    appSlug: z.string(),
})
export type AppRef = z.infer<typeof appSchema>

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

export { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, type ServiceCategory } from '@moldwright/contracts'

function deriveKind(m: { inputs: InputDef[]; mcpServers: McpServerTemplate[] }): AuthMethod['kind'] {
    if (m.mcpServers.some(s => s.oauth)) return 'oauth'
    if (m.mcpServers.some(s => s.transport === 'stdio')) return 'stdio'
    if (m.inputs.length > 0 || m.mcpServers.length > 0) return 'key'
    return 'none'
}

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
    multiInstance: z.boolean().default(false),
})

export const serviceManifestSchema = rawServiceManifestSchema.transform(m => ({
    ...m,
    authMethods:
        m.authMethods.length > 0
            ? m.authMethods
            : [{ id: 'default', label: '', kind: deriveKind(m), recommended: true, inputs: m.inputs, mcpServers: m.mcpServers, envKeys: m.envKeys }],
}))
export type ServiceManifest = z.infer<typeof serviceManifestSchema>

export function defaultMethod(manifest: ServiceManifest): AuthMethod {
    return manifest.authMethods.find(m => m.recommended) ?? manifest.authMethods[0]
}

export function getMethod(manifest: ServiceManifest, id?: string): AuthMethod {
    if (id) return manifest.authMethods.find(m => m.id === id) ?? defaultMethod(manifest)
    return defaultMethod(manifest)
}

export function missingRequiredInputs(method: AuthMethod, values: Record<string, string>): InputDef[] {
    return method.inputs.filter(i => i.required && !values[i.key]?.trim())
}

export function requiredSecretInputs(method: AuthMethod): InputDef[] {
    return method.inputs.filter(i => i.required && i.secret)
}

export function oauthServer(method: AuthMethod): McpServerTemplate | undefined {
    return method.mcpServers.find(s => s.oauth)
}

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
                    ? 'Several ways to connect this one, so the account owner picks in the Moldwright app.'
                    : 'Waiting for a credential the account owner pastes in the Moldwright app.',
        }
    }
    if (appTarget(method)) {
        return { outcome: 'needs_auth', reason: 'Installed, but waiting for the account owner to pick which connected account the coworker acts with.' }
    }
    if (oauthServer(method) || managedTarget(method) || composioTarget(method)) {
        return { outcome: 'needs_auth', reason: 'Installed, but waiting for the account owner to sign in from the Moldwright app.' }
    }
    return { outcome: 'active', reason: 'Installs on its own, no credential and no sign-in.' }
}

export function managedTarget(method: AuthMethod): { provider: string; serverName: string } | null {
    if (method.kind !== 'managed' || !method.managed) return null
    const serverName = method.mcpServers[0]?.name
    if (!serverName) return null
    return { provider: method.managed.provider, serverName }
}

export function composioTarget(method: AuthMethod): { toolkit: string; serverName: string } | null {
    if (method.kind !== 'composio' || !method.composio) return null
    const serverName = method.mcpServers[0]?.name
    if (!serverName) return null
    return { toolkit: method.composio.toolkit, serverName }
}

export function appTarget(method: AuthMethod): { appSlug: string; serverName: string } | null {
    if (method.kind !== 'app' || !method.app) return null
    const serverName = method.mcpServers[0]?.name
    if (!serverName) return null
    return { appSlug: method.app.appSlug, serverName }
}
