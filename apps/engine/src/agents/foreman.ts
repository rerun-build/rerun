import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, TOOL_KEYS, agentKindPolicy, type AgentConfig } from '@rerun/contracts'
import { configPath, soulPath, workspaceDir } from '../config/paths.js'
import { writeAgentConfig } from './config-write.js'
import { agentConfigSchema } from './types.js'
import { unloadAgent } from './registry.js'

// Only what the hub does not send: the brief of each chat request replaces it. A run that reaches
// the foreman without a brief (an old hub, a direct call) still has something coherent to say.
const FOREMAN_SOUL = `# Chief of Staff

You are the Chief of Staff of this Rerun workspace: the assistant that sets up and runs the user's team of coworkers from outside the board. Answer in the user's language, lead with the result, and keep it short.
`

// Who it is and what is installed on the box stay with the code: these fields are rewritten at every
// boot and refused over HTTP. Everything else of its configuration is set like a coworker's.
export const FOREMAN_OWNED_FIELDS = ['name', 'kind', 'ephemeral', 'enabled', 'displayName', 'description', 'selfImprovement', 'setup'] as const satisfies ReadonlyArray<keyof AgentConfig>

type OwnedField = (typeof FOREMAN_OWNED_FIELDS)[number]
type KeptSettings = Omit<AgentConfig, OwnedField>

// It holds every tool a coworker holds, on by default, on top of the account tools the hub hands it.
// A person may switch one off, except the ones its kind locks. Where a tool works differently for
// it, the difference is written where the tool is built (the brain, the hub catalog).
function foremanTools(kept: Partial<AgentConfig['tools']> | undefined): AgentConfig['tools'] {
    const tools = Object.fromEntries(TOOL_KEYS.map(key => [key, kept?.[key] ?? true])) as AgentConfig['tools']
    for (const locked of agentKindPolicy('foreman').lockedTools) tools[locked] = true
    return tools
}

function foremanConfig(kept: Partial<KeptSettings>): AgentConfig {
    return agentConfigSchema.parse({
        ...kept,
        name: FOREMAN_AGENT_ID,
        kind: 'foreman',
        displayName: FOREMAN_DISPLAY_NAME,
        tools: foremanTools(kept.tools),
        // It learns like a coworker (skill proposals, memories kept on its own), but cannot rewrite
        // its soul nor install on the box.
        selfImprovement: { enabled: true, allowToolInstall: false, allowSoulEdit: false, autoMemory: true },
        setup: { required: false },
    })
}

async function keptSettings(): Promise<Partial<KeptSettings>> {
    try {
        const config: Partial<AgentConfig> = agentConfigSchema.parse(JSON.parse(await readFile(configPath(FOREMAN_AGENT_ID), 'utf8')))
        for (const field of FOREMAN_OWNED_FIELDS) delete config[field]
        return config
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
