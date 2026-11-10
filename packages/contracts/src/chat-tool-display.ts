import { capabilityOfCall, PAID_DATA_TOOL, type PaidDataCapability } from './paid-data.js'

// The tools the chat's steps name, the same on every client (`labels.*` of the `tools` catalog): each
// one draws its own icon beside it.
const LABELLED_TOOLS = [
    'shell_exec', 'fs_read', 'fs_write', 'fs_edit', 'fs_list', 'fs_search', 'shared_read', 'shared_write', 'shared_edit', 'shared_list',
    'shared_search', 'browser_navigate', 'computer', 'computer_open_app', 'web_fetch', 'web_search', 'WebSearch', 'leads_people_search',
    'leads_email_find', 'leads_email_verify', 'leads_phone_find', 'google_serp', 'google_maps_search', 'paid_data', 'paid_data_catalog',
    'paid_data_read', 'download', 'memory_write', 'memory_recall', 'brain_search', 'brain_read', 'brain_propose', 'brain_write', 'brain_delete',
    'brain_proposals', 'brain_decide', 'vision_analyze', 'delegate_tasks', 'call_agent', 'team_status', 'team_list_schedules', 'team_list_triggers',
    'team_list_runs', 'team_get_run', 'schedule_list', 'schedule_create', 'schedule_update', 'schedule_delete', 'trigger_list', 'trigger_create',
    'trigger_get', 'trigger_update', 'trigger_rotate_token', 'trigger_delete', 'skill_list', 'skill_read', 'skill_read_file', 'skill_write_file',
    'skill_delete_file', 'skill_create', 'skill_import', 'skill_edit', 'skill_update', 'skill_delete', 'skill_propose', 'soul_update',
    'verbosity_set', 'tool_install', 'mcp_register', 'mcp_login', 'mcp_login_complete', 'mcp_status', 'card_table', 'card_file', 'image_generation', 'table_view_save',
    'table_view_delete', 'rerun_hub_service_search', 'rerun_hub_service_details', 'rerun_hub_service_install', 'rerun_hub_service_list_installed',
    'rerun_hub_service_uninstall', 'rerun_hub_publish_file', 'rerun_hub_unpublish_file', 'rerun_hub_list_published', 'task_complete', 'list_spaces',
    'list_agents', 'get_agent', 'create_agent', 'update_agent', 'delete_agent', 'list_ai_connections', 'set_default_model', 'list_skills',
    'get_skill', 'upsert_skill', 'delete_skill', 'list_schedules', 'upsert_schedule', 'run_schedule_now', 'delete_schedule', 'list_runs', 'get_run',
    'search_connectors', 'list_agent_connectors', 'attach_connector', 'detach_connector', 'send_message', 'create_boxes', 'build_team', 'write_agent',
    'rename_box', 'delete_box', 'focus_agent', 'show_agents', 'open_connector_setup', 'open_settings', 'recenter_board', 'open_brain_page',
    'read_attachment', 'search_docs', 'analyze_website', 'save_profile', 'save_needs', 'list_templates', 'propose_plan', 'install_template',
    'install_shared_agent', 'open_template_card', 'start_agent_setup', 'open_checkout', 'open_template_purchase', 'ask_choice', 'ask_either',
    'ask_input', 'show_templates', 'show_plan', 'show_starter_pack', 'contact_team', 'ask_user', 'request_approval', 'suggest_service',
    'request_secret', 'request_mcp_sign_in', 'request_takeover', 'request_spend', 'notify_user', 'install_complete',
] as const

// The tools that say what they are doing while they run (`activities.*`). A tool missing here falls
// back on its label on each client.
const ACTIVE_TOOLS = [
    'shell_exec', 'fs_read', 'fs_write', 'fs_edit', 'fs_list', 'fs_search', 'shared_read', 'shared_write', 'shared_edit', 'shared_list',
    'shared_search', 'browser_navigate', 'computer', 'computer_open_app', 'web_fetch', 'web_search', 'WebSearch', 'leads_people_search',
    'leads_email_find', 'leads_email_verify', 'leads_phone_find', 'google_serp', 'google_maps_search', 'download', 'memory_write', 'memory_recall',
    'brain_search', 'brain_read', 'brain_propose', 'brain_write', 'vision_analyze', 'image_generation', 'delegate_tasks', 'call_agent', 'team_status', 'team_list_runs',
    'team_get_run', 'skill_read', 'skill_read_file', 'skill_create', 'skill_edit', 'skill_update', 'rerun_hub_service_search',
    'rerun_hub_service_install', 'list_agents', 'create_agent', 'update_agent', 'send_message', 'build_team', 'search_docs', 'analyze_website',
    'list_templates', 'propose_plan', 'install_template',
] as const

export type LabelledTool = (typeof LABELLED_TOOLS)[number]
export type ActiveTool = (typeof ACTIVE_TOOLS)[number]

// The `tools` namespace, in the reader's language.
export type ToolCopy = (key: `labels.${LabelledTool}` | `activities.${ActiveTool}` | `paidData.${PaidDataCapability}`) => string

const labelledTools = new Set<string>(LABELLED_TOOLS)
const activeTools = new Set<string>(ACTIVE_TOOLS)

const isLabelledTool = (toolName: string): toolName is LabelledTool => labelledTools.has(toolName)
const isActiveTool = (toolName: string): toolName is ActiveTool => activeTools.has(toolName)

export function toolActivityOf(toolName: string, input: unknown, t: ToolCopy): string | undefined {
    const capability = toolName === PAID_DATA_TOOL ? capabilityOfCall(toolName, input) : null
    if (capability) return t(`paidData.${capability}`)
    return isActiveTool(toolName) ? t(`activities.${toolName}`) : undefined
}

export function isKnownTool(toolName: string): boolean {
    return isLabelledTool(toolName)
}

export function formatToolName(name: string): string {
    return name
        .replace(/_/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase())
}

// A paid_data call is named after the capability it bought: "Reading TikTok", not "Paid data".
export function toolLabelOf(toolName: string, input: unknown, t: ToolCopy): string {
    const capability = toolName === PAID_DATA_TOOL ? capabilityOfCall(toolName, input) : null
    if (capability) return t(`paidData.${capability}`)
    if (isLabelledTool(toolName)) return t(`labels.${toolName}`)
    if (toolName.startsWith('mcp_')) return formatToolName(toolName.replace(/^mcp__?/, '').replace(/__/g, ' '))
    return formatToolName(toolName)
}

const HEADLINE_ARGS = ['preview', 'command', 'path', 'query', 'url']

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isReadable = (value: unknown): value is string => typeof value === 'string' && !!value && !UUID_PATTERN.test(value.trim())

export const argsOf = (input: unknown) => (input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined)

export function agentIdOf(input: unknown): string | undefined {
    const agentId = argsOf(input)?.agentId
    return typeof agentId === 'string' && agentId ? agentId : undefined
}

// The one line of detail a step shows after its label: what it ran, read or looked up.
export function toolHeadline(input: unknown, agentName?: string): string | undefined {
    const args = argsOf(input)
    if (!args) return undefined
    // A paid_data call says what it looked up, not which capability: the label already names it.
    if (typeof args.capability === 'string' && argsOf(args.params)) return toolHeadline(args.params)
    const named = HEADLINE_ARGS.map(name => args[name]).find(isReadable)
    return named ?? (agentName || Object.values(args).find(isReadable))
}
