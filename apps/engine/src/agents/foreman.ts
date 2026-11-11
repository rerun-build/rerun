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

// The orchestrator works on the box like any agent (files, shell, web, sub-agents, the company
// brain, which it keeps rather than proposes to) and on the account through the tools the hub hands
// it. What stays off is everything of its own it would keep between conversations (memory, skills,
// schedules, triggers, connectors). Of the cards it keeps only the file tiles: the user cannot reach
// the server, so a file it made is seen there or not at all.
const FOREMAN_TOOL_KEYS = new Set<ToolKey>(['filesystem', 'shared', 'shell', 'web', 'sharedDb', 'brain', 'delegate', 'callAgent', 'browser', 'vision', 'askUser', 'requestApproval', 'cards'])

function foremanConfig(modelPin: ModelPin): AgentConfig {
    const tools = Object.fromEntries(TOOL_KEYS.map(key => [key, FOREMAN_TOOL_KEYS.has(key)]))
    return agentConfigSchema.parse({
        ...modelPin,
        name: FOREMAN_AGENT_ID,
        kind: 'foreman',
        displayName: FOREMAN_DISPLAY_NAME,
        tools,
        selfImprovement: { enabled: false, allowToolInstall: false, allowSoulEdit: false, autoMemory: false },
        setup: { required: false },
    })
}

type ModelPin = Pick<AgentConfig, 'connectionId' | 'provider' | 'model'>

// The model is the one thing the user picks for the foreman, as for any agent, so it is the one
// thing a reboot keeps.
async function currentModelPin(): Promise<ModelPin> {
    try {
        const { connectionId, provider, model } = agentConfigSchema.parse(JSON.parse(await readFile(configPath(FOREMAN_AGENT_ID), 'utf8')))
        return { connectionId, provider, model }
    } catch {
        return { connectionId: null, provider: null, model: null }
    }
}

// Rewritten from code on every boot rather than created once, so each engine update ships the
// foreman it was built with. Deliberately never inserted in the agent index.
export async function ensureForeman(): Promise<void> {
    await mkdir(workspaceDir(FOREMAN_AGENT_ID), { recursive: true })
    await writeAgentConfig(FOREMAN_AGENT_ID, foremanConfig(await currentModelPin()))
    await writeFile(soulPath(FOREMAN_AGENT_ID), FOREMAN_SOUL, 'utf8')
    unloadAgent(FOREMAN_AGENT_ID)
}
