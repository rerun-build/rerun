import type { ForemanBrief, ForemanToolSpec } from '@moldwright/contracts'

import type { ForemanState } from './phase'
import { foremanEngineInstructions } from './prompt'
import { FOREMAN_BOX_TOOL_DEFS, FOREMAN_CLIENT_TOOL_DEFS, FOREMAN_DOCS_TOOL_DEFS, FOREMAN_MCP_TOOL_NAMES, FOREMAN_ONBOARDING_TOOL_DEFS, accountToolDef, type ForemanClientToolName, type ForemanToolDef } from './tool-defs'

const ENGINE_INTENT_TOOL_NAMES = new Set<ForemanClientToolName>(['focus_agent', 'show_agents', 'open_settings', 'open_connector_setup', 'open_template_card', 'recenter_board', 'open_brain_page'])

export const FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES: ReadonlySet<string> = new Set(['analyze_website', 'list_templates', 'install_template', 'install_shared_agent', 'start_agent_setup'])

const SERIAL_TOOL_NAMES = new Set<string>(['create_agent', 'create_boxes', 'install_template', 'install_shared_agent'])

const HUB_TOOL_DEFS: ForemanToolDef[] = [...FOREMAN_MCP_TOOL_NAMES.map(accountToolDef), ...FOREMAN_BOX_TOOL_DEFS, ...FOREMAN_DOCS_TOOL_DEFS, ...FOREMAN_ONBOARDING_TOOL_DEFS.filter(def => FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES.has(def.name))]

export const FOREMAN_ENGINE_HUB_TOOL_NAMES: ReadonlySet<string> = new Set(HUB_TOOL_DEFS.map(def => def.name))

function spec(def: ForemanToolDef, kind: ForemanToolSpec['kind']): ForemanToolSpec {
    return { name: def.name, description: def.description, inputSchema: def.inputSchema as Record<string, unknown>, kind, serial: SERIAL_TOOL_NAMES.has(def.name) }
}

export function foremanEngineBrief(state: ForemanState): ForemanBrief {
    return {
        instructions: foremanEngineInstructions(state),
        tools: [...HUB_TOOL_DEFS.map(def => spec(def, 'hub')), ...FOREMAN_CLIENT_TOOL_DEFS.filter(def => ENGINE_INTENT_TOOL_NAMES.has(def.name)).map(def => spec(def, 'intent'))],
    }
}
