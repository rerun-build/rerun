import { z } from 'zod'

import { inputDefSchema } from './input.js'

export const SERVICE_INSTANCE_ID_RE = /^[a-z0-9]{6}$/

export function serviceRegistryKey(slug: string, instanceId?: string): string {
    return instanceId ? `${slug}@${instanceId}` : slug
}

export function parseServiceRegistryKey(key: string): { slug: string; instanceId?: string } {
    const at = key.lastIndexOf('@')
    if (at <= 0) return { slug: key }
    const instanceId = key.slice(at + 1)
    if (!SERVICE_INSTANCE_ID_RE.test(instanceId)) return { slug: key }
    return { slug: key.slice(0, at), instanceId }
}

export function isServiceRegistryKey(key: string): boolean {
    return key.length > 0 && parseServiceRegistryKey(key).instanceId !== undefined
}

export const agentServiceStatusSchema = z.enum(['active', 'needs_config', 'needs_auth', 'error'])
export type AgentServiceStatus = z.infer<typeof agentServiceStatusSchema>

export const pendingAuthSchema = z.enum(['oauth', 'managed', 'composio', 'app'])
export type PendingAuth = z.infer<typeof pendingAuthSchema>

export const authMethodSummarySchema = z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['oauth', 'key', 'stdio', 'none', 'managed', 'composio', 'app']),
    recommended: z.boolean(),
    inputs: z.array(inputDefSchema),
    requiresSecrets: z.boolean(),
})
export type AuthMethodSummary = z.infer<typeof authMethodSummarySchema>

export const installedServiceSchema = z.object({
    key: z.string().optional(),
    slug: z.string(),
    instanceId: z.string().optional(),
    label: z.string().optional(),
    name: z.string(),
    icon: z.string().nullable(),
    category: z.string(),
    status: agentServiceStatusSchema,
    toolNames: z.array(z.string()),
    authMethodId: z.string().optional(),
    installedAt: z.string(),
})
export type InstalledServiceView = z.infer<typeof installedServiceSchema>

export const resolvedServiceSchema = z.object({
    key: z.string().optional(),
    slug: z.string(),
    label: z.string().optional(),
    name: z.string(),
    category: z.string(),
    summary: z.string(),
    icon: z.string().nullable(),
    verified: z.boolean(),
    reason: z.string().optional(),
    authMethods: z.array(authMethodSummarySchema),
    installStatus: agentServiceStatusSchema.nullable(),
    installedMethodId: z.string().optional(),
    pendingAuth: pendingAuthSchema.nullable(),
    notFound: z.boolean(),
    multiInstance: z.boolean().default(false),
})
export type ResolvedService = z.infer<typeof resolvedServiceSchema>

export const resolveServicesInputSchema = z.object({
    services: z.array(z.object({ slug: z.string().min(1), reason: z.string().optional() })).min(1).max(20),
})

export const installServiceInputSchema = z.object({
    values: z.record(z.string(), z.string()).default({}),
    authMethodId: z.string().optional(),
})

export const installResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('installed'), key: z.string().optional(), slug: z.string(), name: z.string(), toolNames: z.array(z.string()), message: z.string() }),
    z.object({ status: z.literal('needs_config'), key: z.string().optional(), slug: z.string(), name: z.string(), authMethods: z.array(authMethodSummarySchema), authMethodId: z.string().optional(), message: z.string() }),
    z.object({ status: z.literal('needs_auth'), key: z.string().optional(), slug: z.string(), name: z.string(), pendingAuth: pendingAuthSchema, connectUrl: z.string(), message: z.string() }),
])
export type InstallResultView = z.infer<typeof installResultSchema>

export const resetConnectionSchema = z.union([
    z.object({ mode: z.literal('auth'), pendingAuth: pendingAuthSchema.nullable() }),
    z.object({ mode: z.literal('config'), authMethodId: z.string().optional() }),
])
export type ResetConnectionView = z.infer<typeof resetConnectionSchema>

export const connectTargetSchema = z.object({ url: z.string(), returnUrl: z.string() })
export type ConnectTarget = z.infer<typeof connectTargetSchema>

export const signInClaimSchema = z.object({ claim: z.string().min(1).max(64) })
export type SignInClaim = z.infer<typeof signInClaimSchema>

export const mcpServerViewSchema = z.object({
    name: z.string(),
    displayName: z.string(),
    host: z.string().nullable(),
    icon: z.string().nullable(),
    status: z.enum(['connected', 'needs_auth', 'error', 'unknown']),
    canSignIn: z.boolean(),
})
export type McpServerView = z.infer<typeof mcpServerViewSchema>

export const serviceSearchResultSchema = z.object({
    slug: z.string(),
    name: z.string(),
    category: z.string(),
    summary: z.string(),
    icon: z.string().nullable(),
    requiresSecrets: z.boolean(),
    installed: z.boolean(),
    installStatus: agentServiceStatusSchema.nullable(),
    verified: z.boolean(),
    multiInstance: z.boolean().default(false),
})
export type ServiceSearchResultView = z.infer<typeof serviceSearchResultSchema>

export const SERVICE_CATEGORIES = [
    'payments',
    'ecommerce',
    'crm',
    'marketing',
    'seo',
    'analytics',
    'dev',
    'productivity',
    'other',
] as const
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
    payments: 'Payments',
    ecommerce: 'E-commerce',
    crm: 'CRM',
    marketing: 'Marketing',
    seo: 'SEO',
    analytics: 'Analytics',
    dev: 'Developer',
    productivity: 'Productivity',
    other: 'Other',
}
