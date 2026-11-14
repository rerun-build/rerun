export const SETTINGS_PANELS = ['workspace', 'members', 'api_keys', 'ai_providers', 'knowledge_base', 'billing', 'notifications', 'shortcuts', 'delete_account'] as const

export type SettingsPanel = (typeof SETTINGS_PANELS)[number]

export const SETTINGS_PANEL_LABELS: Record<SettingsPanel, string> = {
    workspace: 'Workspace settings',
    members: 'Members',
    api_keys: 'API keys & MCP',
    ai_providers: 'AI providers',
    knowledge_base: 'Brain',
    billing: 'Billing',
    notifications: 'Notifications',
    shortcuts: 'Shortcuts',
    delete_account: 'Delete account',
}

export type WorkspaceDialogPanel = Extract<SettingsPanel, 'workspace' | 'members' | 'api_keys' | 'ai_providers' | 'knowledge_base'>

export const KNOWLEDGE_BASE_TABS = ['company', 'proposals', 'published', 'files', 'database'] as const

export type KnowledgeBaseTab = (typeof KNOWLEDGE_BASE_TABS)[number]
