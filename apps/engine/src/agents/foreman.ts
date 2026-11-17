import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, TOOL_KEYS, type AgentConfig, type ToolKey } from '@rerun/contracts'
import { configPath, soulPath, workspaceDir } from '../config/paths.js'
import { writeAgentConfig } from './config-write.js'
import { agentConfigSchema } from './types.js'
import { unloadAgent } from './registry.js'

// Only what the hub does not send: the brief of each chat request replaces it. A run that reaches
// the foreman without a brief (an old hub, a direct call) still has something coherent to say.
const FOREMAN_SOUL = `# Chief of Staff

You are the Chief of Staff of this Rerun workspace: the assistant that sets up and runs the user's team of coworkers from outside the board. Answer in the user's language, lead with the result, and keep it short.
`

// A coworker's tools, with the account tools the hub hands it on top. What stays off:
// - schedules and triggers: a run with nobody in front of it would act with nobody's rights;
// - team and aiProviders: its account tools cover them, and two tools for one gesture lose the model;
// - quick replies: it closes on its own next steps;
// - notify: it only ever answers the member in front of it.
// Its apps come from the Vault only: an MCP server written into its config would not survive the
// next boot.
const FOREMAN_TOOLS_OFF = new Set<ToolKey>(['schedule', 'trigger', 'team', 'aiProviders', 'quickReplies', 'notify'])

function foremanConfig(kept: Partial<KeptSettings>): AgentConfig {
    const tools = Object.fromEntries(TOOL_KEYS.map(key => [key, !FOREMAN_TOOLS_OFF.has(key)]))
    return agentConfigSchema.parse({
        ...kept,
        name: FOREMAN_AGENT_ID,
        kind: 'foreman',
        displayName: FOREMAN_DISPLAY_NAME,
        tools,
        // Its memory and skills are the team's, written when a member asks: a curator reading private
        // conversations would mix one member's preferences into everyone's.
        selfImprovement: { enabled: false, allowToolInstall: false, allowSoulEdit: false, autoMemory: false },
        setup: { required: false },
    })
}

// What the user picks for the foreman, as for any agent: the model it runs on and whether it may
// spend on paid data without asking. The only fields a reboot keeps, and the only ones the hub may
// change.
export const FOREMAN_KEPT_FIELDS = ['connectionId', 'provider', 'model', 'paidDataAlwaysAllow'] as const

type KeptSettings = Pick<AgentConfig, (typeof FOREMAN_KEPT_FIELDS)[number]>

async function keptSettings(): Promise<Partial<KeptSettings>> {
    try {
        const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(FOREMAN_AGENT_ID), 'utf8')))
        return Object.fromEntries(FOREMAN_KEPT_FIELDS.map(field => [field, config[field]]))
    } catch {
        return {}
    }
}

// Rewritten from code on every boot rather than created once, so each engine update ships the
// foreman it was built with. Deliberately never inserted in the agent index.
export async function ensureForeman(): Promise<void> {
    await mkdir(workspaceDir(FOREMAN_AGENT_ID), { recursive: true })
    await writeAgentConfig(FOREMAN_AGENT_ID, foremanConfig(await keptSettings()))
    await writeFile(soulPath(FOREMAN_AGENT_ID), FOREMAN_SOUL, 'utf8')
    unloadAgent(FOREMAN_AGENT_ID)
}
