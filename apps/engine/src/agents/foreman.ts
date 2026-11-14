import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, TOOL_KEYS, type AgentConfig, type ToolKey } from '@rerun/contracts'
import { configPath, soulPath, workspaceDir } from '../config/paths.js'
import { writeAgentConfig } from './config-write.js'
import { agentConfigSchema } from './types.js'
import { unloadAgent } from './registry.js'

const FOREMAN_SOUL = `# Chief of Staff

You are the Chief of Staff of this Rerun workspace: the assistant that sets up and runs the user's team of coworkers from outside the board. Answer in the user's language, lead with the result, and keep it short.
`

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

async function currentModelPin(): Promise<ModelPin> {
    try {
        const { connectionId, provider, model } = agentConfigSchema.parse(JSON.parse(await readFile(configPath(FOREMAN_AGENT_ID), 'utf8')))
        return { connectionId, provider, model }
    } catch {
        return { connectionId: null, provider: null, model: null }
    }
}

export async function ensureForeman(): Promise<void> {
    await mkdir(workspaceDir(FOREMAN_AGENT_ID), { recursive: true })
    await writeAgentConfig(FOREMAN_AGENT_ID, foremanConfig(await currentModelPin()))
    await writeFile(soulPath(FOREMAN_AGENT_ID), FOREMAN_SOUL, 'utf8')
    unloadAgent(FOREMAN_AGENT_ID)
}
