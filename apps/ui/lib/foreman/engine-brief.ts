import type { ForemanBrief, ForemanToolSpec } from '@rerun/contracts'

import type { ForemanState } from './phase'
import { foremanEngineInstructions } from './prompt'
import { FOREMAN_BOX_TOOL_DEFS, FOREMAN_CLIENT_TOOL_DEFS, FOREMAN_DOCS_TOOL_DEFS, FOREMAN_MCP_TOOL_NAMES, FOREMAN_ONBOARDING_TOOL_DEFS, FOREMAN_VAULT_TOOL_DEFS, FOREMAN_IDENTITY_TOOL_DEFS, foremanAccountToolDef, type ForemanClientToolName, type ForemanToolDef } from './tool-defs'

// The belt of the foreman that runs on the engine. Everything the hub executes goes through
// POST /api/hub; the board gestures only reach the browser, as transient data parts, so nothing
// here waits on the user except the engine's own ask_user and request_approval. Its files, shell,
// web and sub-agents are the engine's own builtins, not declared here.
//
// Left out on purpose: the widgets (a plan card, a checkout), which the engine cannot render, the
// attachment tools, since a file sent to it lands in its own workspace where its fs_ tools already
// read it, and the onboarding writes (profile, needs), which belong to a person going through
// it on the hub, never to the foreman that takes over once the team is built.

const ENGINE_INTENT_TOOL_NAMES = new Set<ForemanClientToolName>(['focus_agent', 'show_agents', 'open_settings', 'open_connector_setup', 'open_template_card', 'recenter_board', 'open_brain_page'])

export const FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES: ReadonlySet<string> = new Set(['analyze_website', 'list_templates', 'install_template', 'install_shared_agent', 'start_agent_setup'])

// createAgent and createBoxes read then write without a transaction: two in the same step would
// take the same handle, the same cell, or the same free slot of the plan. An install creates agents
// the same way.
const SERIAL_TOOL_NAMES = new Set<string>(['create_agent', 'create_boxes', 'install_template', 'install_shared_agent'])

const HUB_TOOL_DEFS: ForemanToolDef[] = [...FOREMAN_MCP_TOOL_NAMES.map(foremanAccountToolDef), ...FOREMAN_BOX_TOOL_DEFS, ...FOREMAN_VAULT_TOOL_DEFS, ...FOREMAN_IDENTITY_TOOL_DEFS, ...FOREMAN_DOCS_TOOL_DEFS, ...FOREMAN_ONBOARDING_TOOL_DEFS.filter(def => FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES.has(def.name))]

export const FOREMAN_ENGINE_HUB_TOOL_NAMES: ReadonlySet<string> = new Set(HUB_TOOL_DEFS.map(def => def.name))

function spec(def: ForemanToolDef, kind: ForemanToolSpec['kind']): ForemanToolSpec {
    return { name: def.name, description: def.description, inputSchema: def.inputSchema as Record<string, unknown>, kind, serial: SERIAL_TOOL_NAMES.has(def.name) }
}

// The hub tools a run nobody started may call. A written list rather than a rule: a tool joins it only
// once someone decided it reads and nothing more, and a test holds it to this list. Left out on
// purpose, although they look like reads: send_message (starts a coworker's run), run_schedule_now,
// test_trigger, rotate_trigger_token, and analyze_website (reaches the web).
export const WAKE_HUB_TOOL_NAMES: ReadonlySet<string> = new Set([
    'list_spaces',
    'list_agents',
    'get_team_status',
    'get_agent',
    'list_ai_connections',
    'list_skills',
    'get_skill',
    'read_skill_file',
    'list_schedules',
    'list_triggers',
    'list_runs',
    'get_run',
    'list_tables',
    'db_query',
    'list_space_tables',
    'space_db_query',
    'search_connectors',
    'list_connectors',
    'list_agent_connectors',
    'list_agent_shares',
    'search_docs',
    'list_templates',
    'list_vault',
])

// No intent tool: nobody's browser is watching a run nobody started.
export function foremanWakeTools(): ForemanToolSpec[] {
    return HUB_TOOL_DEFS.filter(def => WAKE_HUB_TOOL_NAMES.has(def.name)).map(def => spec(def, 'hub'))
}

// What the box can draw, read from its /health: an engine tool named in the brief exists only there.
// `wakes`: the box wakes it on its own and the workspace is open to it, so it may plan when.
export type ForemanBoxCapabilities = { connectApp: boolean; wakes: boolean }

export function foremanEngineBrief(state: ForemanState, capabilities: ForemanBoxCapabilities): ForemanBrief {
    return {
        instructions: foremanEngineInstructions(state, capabilities),
        builtins: [...(capabilities.connectApp ? ['connect_app'] : []), ...(capabilities.wakes ? ['schedule_wake'] : [])],
        tools: [...HUB_TOOL_DEFS.map(def => spec(def, 'hub')), ...FOREMAN_CLIENT_TOOL_DEFS.filter(def => ENGINE_INTENT_TOOL_NAMES.has(def.name)).map(def => spec(def, 'intent'))],
    }
}
