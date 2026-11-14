import type { Database } from '@/app/api/database.types'

export type AgentRow = Database['public']['Tables']['agents']['Row']
export type AgentInsert = Database['public']['Tables']['agents']['Insert']
export type SessionRow = Database['public']['Tables']['sessions']['Row']
export type SpaceRow = Database['public']['Tables']['spaces']['Row']
export type SpacePublic = Pick<SpaceRow, 'id' | 'workspace_id' | 'name' | 'col_start' | 'row_start' | 'col_end' | 'row_end' | 'created_at'> & Partial<Pick<SpaceRow, 'visibility'>>
export type SpaceInsert = Database['public']['Tables']['spaces']['Insert']
export type SpaceUpdate = Database['public']['Tables']['spaces']['Update']
export type SessionStatus = Database['public']['Enums']['session_status']
export type AgentStatus = Database['public']['Enums']['agent_status']
export type InteractionMode = 'select' | 'space'

export const UNNAMED_BOX_LABEL = 'Untitled Box'

export const BOX_NAME_MAX = 60


export type SessionEntry = {
    id: string
    agentId: string
    originAgentId: string | null
    status: SessionStatus
}

export type AgentLink = {
    source: string
    target: string
}

const STATUS_PRIORITY: Record<string, number> = {
    working: 3,
    awaiting_approval: 2.5,
    awaiting_question: 2.5,
    awaiting_connector: 2.5,
    awaiting_ack: 2.5,
    error: 2,
    waiting_human: 1,
    idle: 0,
}

function priorityOf(status: string): number {
    return STATUS_PRIORITY[status] ?? 0
}

export function computeAgentStatus(sessions: SessionEntry[], isOnline: boolean, engineBusy = false): AgentStatus {
    if (!isOnline) return 'offline'
    if (engineBusy) return 'working'
    let best: string = 'idle'
    for (const s of sessions) {
        if (priorityOf(s.status) > priorityOf(best)) {
            best = s.status
        }
    }
    if (best === 'awaiting_question' || best === 'awaiting_approval' || best === 'awaiting_connector' || best === 'awaiting_ack') return 'waiting_human'
    return best as AgentStatus
}

export type GridPosition = { col: number; row: number }

export type IsoAgent = {
    id: string
    name: string
    handle: string | null
    description: string | null
    templateId: string | null
    status: AgentStatus
    position: GridPosition
    workspaceId: number
    spaceId: string
    disabledAt: string | null
    disabledReason: string | null
}

type AgentRowFields = Pick<AgentRow, 'id' | 'name' | 'handle' | 'description' | 'template_id' | 'status' | 'col' | 'row' | 'workspace_id' | 'space_id' | 'disabled_at' | 'disabled_reason'>

export function agentFromRow(row: AgentRowFields): IsoAgent {
    return {
        id: row.id,
        name: row.name,
        handle: row.handle,
        description: row.description,
        templateId: row.template_id,
        status: (row.status as AgentStatus) || 'idle',
        position: { col: row.col, row: row.row },
        workspaceId: row.workspace_id,
        spaceId: row.space_id,
        disabledAt: row.disabled_at,
        disabledReason: row.disabled_reason,
    }
}

export const PLAN_LIMIT_REASON = 'plan_limit'

export function isPlanLimited(agent: Pick<IsoAgent, 'disabledReason'>): boolean {
    return agent.disabledReason === null || agent.disabledReason === PLAN_LIMIT_REASON
}

export const AGENT_FOCUS_TABS = ['chat', 'actions', 'services', 'mcp', 'skills', 'data', 'memories', 'files', 'published', 'scheduled', 'triggers', 'tools', 'monitoring', 'logs', 'setup', 'settings'] as const

export type AgentFocusTab = (typeof AGENT_FOCUS_TABS)[number]

export const AGENT_TAB_LABELS: Record<AgentFocusTab, string> = {
    chat: 'Chat',
    actions: 'To handle',
    services: 'Apps',
    mcp: 'MCP',
    skills: 'Skills',
    data: 'Database',
    memories: 'Knowledge',
    files: 'Files',
    published: 'Published',
    scheduled: 'Routines',
    triggers: 'Triggers',
    tools: 'Capabilities',
    monitoring: 'Monitoring',
    logs: 'Logs',
    setup: 'Install',
    settings: 'Settings',
}

export function resolveTab<T extends string>(value: string, labels: Record<T, string>): T | null {
    const wanted = value.trim().toLowerCase()
    const match = (Object.entries(labels) as [T, string][]).find(([id, label]) => id === wanted || label.toLowerCase() === wanted)
    return match ? match[0] : null
}
