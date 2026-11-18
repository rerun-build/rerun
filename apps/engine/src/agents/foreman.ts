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

// The orchestrator works on the box like any coworker (files, shell, web, sub-agents, its own memory,
// skills and routines, the company brain, which it keeps rather than proposes to) and on the account
// through the tools the hub hands it. What stays off is what needs a place on the board (a webhook
// address, an installation) or the catalog a coworker installs from. Of the cards it keeps only the
// file tiles: the user cannot reach the server, so a file it made is seen there or not at all.
const FOREMAN_TOOL_KEYS = new Set<ToolKey>(['filesystem', 'shared', 'shell', 'web', 'memory', 'sharedDb', 'skills', 'schedule', 'brain', 'delegate', 'callAgent', 'browser', 'vision', 'askUser', 'requestApproval', 'cards'])

function foremanConfig(kept: Partial<KeptSettings>): AgentConfig {
    const tools = Object.fromEntries(TOOL_KEYS.map(key => [key, FOREMAN_TOOL_KEYS.has(key)]))
    return agentConfigSchema.parse({
        ...kept,
        name: FOREMAN_AGENT_ID,
        kind: 'foreman',
        displayName: FOREMAN_DISPLAY_NAME,
        tools,
        // It learns like a coworker (skill proposals, memories kept on its own), but who it is and
        // what is installed on the box stay with the code.
        selfImprovement: { enabled: true, allowToolInstall: false, allowSoulEdit: false, autoMemory: true },
        setup: { required: false },
    })
}

type KeptSettings = Pick<AgentConfig, 'connectionId' | 'provider' | 'model' | 'mcpServers' | 'verbosity'>

// What a person, or the foreman itself, set on it: the model it runs on, the servers connected to
// it and how long its answers are. Everything else is the code's, so it is all a reboot keeps.
async function keptSettings(): Promise<Partial<KeptSettings>> {
    try {
        const { connectionId, provider, model, mcpServers, verbosity } = agentConfigSchema.parse(JSON.parse(await readFile(configPath(FOREMAN_AGENT_ID), 'utf8')))
        return { connectionId, provider, model, mcpServers, verbosity }
    } catch {
        return {}
    }
}

// Rewritten from code on every boot rather than created once, so each engine update ships the
// foreman it was built with. Its skills, memories and routines are files beside the config, which
// this never touches. Deliberately never inserted in the agent index.
export async function ensureForeman(): Promise<void> {
    await mkdir(workspaceDir(FOREMAN_AGENT_ID), { recursive: true })
    await writeAgentConfig(FOREMAN_AGENT_ID, foremanConfig(await keptSettings()))
    await writeFile(soulPath(FOREMAN_AGENT_ID), FOREMAN_SOUL, 'utf8')
    unloadAgent(FOREMAN_AGENT_ID)
}
