import type { AgentFocusTab } from '@/lib/board/types'

export const AGENT_SHEET_VIEWS = {
    apps: ['services', 'mcp'],
    skills: ['skills'],
    knowledge: ['memories'],
    files: ['files', 'published'],
    data: ['data'],
    routines: ['scheduled', 'triggers'],
    activity: ['monitoring', 'logs'],
    settings: ['settings', 'tools', 'setup'],
} as const satisfies Record<string, readonly AgentFocusTab[]>

export type AgentSheetView = keyof typeof AGENT_SHEET_VIEWS

export type AgentViewTab = (typeof AGENT_SHEET_VIEWS)[AgentSheetView][number]

export const AGENT_SHEET_VIEW_LABELS: Record<AgentSheetView, string> = {
    apps: 'Apps',
    skills: 'Skills',
    knowledge: 'Knowledge',
    files: 'Files',
    data: 'Database',
    routines: 'Routines',
    activity: 'Activity',
    settings: 'Settings',
}

export const AGENT_VIEW_TAB_LABELS: Record<AgentViewTab, string> = {
    services: 'Apps',
    mcp: 'MCP',
    skills: 'Skills',
    memories: 'Knowledge',
    files: 'Files',
    published: 'Published',
    data: 'Database',
    scheduled: 'Scheduled',
    triggers: 'Triggers',
    monitoring: 'Monitoring',
    logs: 'Logs',
    settings: 'General',
    tools: 'Capabilities',
    setup: 'Install',
}

const VIEW_OF_TAB = Object.fromEntries((Object.entries(AGENT_SHEET_VIEWS) as [AgentSheetView, readonly AgentViewTab[]][]).flatMap(([view, tabs]) => tabs.map(tab => [tab, view]))) as Record<AgentViewTab, AgentSheetView>

export function isAgentViewTab(tab: AgentFocusTab): tab is AgentViewTab {
    return tab in VIEW_OF_TAB
}

export function agentSheetViewOf(tab: AgentViewTab): AgentSheetView {
    return VIEW_OF_TAB[tab]
}
