// The settings surfaces of the app, the ones that live in a dialog over the board rather than on a
// tab of a panel. Declared here rather than beside their dialogs so the stores and the foreman's
// tool belt can name one without importing the component it opens, exactly as lib/board/types.ts
// does for the tabs of the agent panel.
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

// The ones the workspace settings store owns. The others already have a store of their own.
// The Vault is one of them, but stays out of SETTINGS_PANELS until it ships: the foreman offers every
// panel listed there, and must not open one the workspace cannot see yet.
export type WorkspaceDialogPanel = Extract<SettingsPanel, 'workspace' | 'members' | 'api_keys' | 'ai_providers' | 'knowledge_base'> | 'vault'

// The tabs of the Brain dialog: the company pages every agent reads, the changes agents propose to
// them, the links they published, the shared folder and the shared database. The panel id keeps its
// older name.
export const KNOWLEDGE_BASE_TABS = ['company', 'proposals', 'published', 'files', 'database'] as const

export type KnowledgeBaseTab = (typeof KNOWLEDGE_BASE_TABS)[number]
