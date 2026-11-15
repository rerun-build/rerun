import type { InputDef, InstallOutcome } from './manifest'

export type AgentServiceStatus = 'active' | 'needs_config' | 'needs_auth' | 'error'

export type OAuthTarget = { serverName: string; url: string }

export type ManagedTarget = { provider: string; serverName: string; accountEmail?: string }

export type ComposioTarget = { toolkit: string; serverName: string; accountLabel?: string }

export type AppTarget = { appSlug: string; serverName: string; accountLabel?: string }

export type AuthMethodSummary = {
    id: string
    label: string
    kind: 'oauth' | 'key' | 'stdio' | 'none' | 'managed' | 'composio' | 'app'
    recommended: boolean
    inputs: InputDef[]
    requiresSecrets: boolean
}

export type ServiceAlternative = { slug: string; name: string; category: string; icon: string | null }

export type ServiceSearchResult = {
    slug: string
    name: string
    category: string
    summary: string
    icon: string | null
    requiresSecrets: boolean
    setup: InstallOutcome
    setupReason: string
    installed: boolean
    installStatus: AgentServiceStatus | null
    verified: boolean
    paidApp?: boolean
    multiInstance: boolean
    similarity?: number
}

export type ServiceInstanceSummary = { key: string; label?: string; status: AgentServiceStatus }

export type ServiceDetails = {
    key: string
    slug: string
    label?: string
    name: string
    category: string
    summary: string
    description: string
    authMethods: AuthMethodSummary[]
    installed: boolean
    installStatus: AgentServiceStatus | null
    installedMethodId?: string
    oauth?: OAuthTarget
    managed?: ManagedTarget
    composio?: ComposioTarget
    app?: AppTarget
    multiInstance: boolean
    instances: ServiceInstanceSummary[]
}

export type InstalledService = {
    key: string
    slug: string
    instanceId?: string
    label?: string
    name: string
    icon: string | null
    category: string
    status: AgentServiceStatus
    toolNames: string[]
    oauth?: OAuthTarget
    managed?: ManagedTarget
    composio?: ComposioTarget
    app?: AppTarget
    authMethodId?: string
    installedAt: string
}

export type ResetConnectionResult = { mode: 'auth'; oauth?: OAuthTarget; managed?: ManagedTarget; composio?: ComposioTarget; app?: AppTarget } | { mode: 'config'; authMethodId?: string }

export type InstallResult =
    | { status: 'installed'; key: string; slug: string; name: string; toolNames: string[]; message: string }
    | { status: 'needs_config'; key: string; slug: string; name: string; authMethods: AuthMethodSummary[]; authMethodId?: string; message: string }
    | { status: 'needs_auth'; key: string; slug: string; name: string; oauth?: OAuthTarget; managed?: ManagedTarget; composio?: ComposioTarget; app?: AppTarget; message: string }

export type PublishedAccessMode = 'public' | 'workspace' | 'password' | 'invited'

export type PublishResult = {
    status: 'published'
    url: string
    fileUrl: string | null
    slug: string
    path: string
    kind: 'file' | 'site'
    contentType: string
    size: number
    title: string
    access: PublishedAccessMode
    requestedAccess: 'public' | null
    message: string
}

export type PublishedFile = {
    slug: string
    agentId: string
    path: string
    url: string
    fileUrl: string | null
    kind: 'file' | 'site'
    contentType: string
    size: number
    title: string
    access: PublishedAccessMode
    requestedAccess: 'public' | null
    invited: string[]
    hasPassword: boolean
    thumbnailUrl: string | null
    publishedAt: string
    updatedAt: string
}

export type ServiceChecklistItem = { slug: string; name: string; authMethods: AuthMethodSummary[] }

export type McpTransportKind = 'stdio' | 'sse' | 'http'

export type CustomMcpServer = {
    name: string
    displayName: string
    transport: McpTransportKind
    host: string | null
    icon: string | null
    signInUrl: string | null
}

export type CustomMcpLiveStatus = 'connected' | 'needs_auth' | 'error' | 'unknown'

export type CustomMcpStatus = { name: string; status: CustomMcpLiveStatus; toolCount: number; error?: string }
