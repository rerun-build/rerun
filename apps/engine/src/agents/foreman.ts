import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, TOOL_KEYS, type AgentConfig } from '@rerun/contracts'
import { configPath, soulPath, workspaceDir } from '../config/paths.js'
import { writeAgentConfig } from './config-write.js'
import { agentConfigSchema } from './types.js'
import { unloadAgent } from './registry.js'

// Only what the hub does not send: the brief of each chat request replaces it. A run that reaches
// the foreman without a brief (an old hub, a direct call) still has something coherent to say.
const FOREMAN_SOUL = `# Chief of Staff

You are the Chief of Staff of this Rerun workspace: the assistant that sets up and runs the user's team of coworkers from outside the board. Answer in the user's language, lead with the result, and keep it short.
`

// The orchestrator holds every tool a coworker holds, switched on as a coworker's are by default, on
// top of the account tools the hub hands it. Where one of them works differently for it, the
// difference is written where the tool is built (the brain, the hub catalog).
function foremanConfig(kept: Partial<KeptSettings>): AgentConfig {
    const tools = Object.fromEntries(TOOL_KEYS.map(key => [key, true]))
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

type KeptSettings = Pick<AgentConfig, 'connectionId' | 'provider' | 'model' | 'effort' | 'mcpServers' | 'verbosity' | 'proactive' | 'paidDataAlwaysAllow'>

// What a person, or the foreman itself, set on it: the model it runs on, the servers connected to
// it, how long its answers are, whether it checks in on its own and whether paid data still asks
// before spending. Everything else is the code's, so it is all a reboot keeps.
async function keptSettings(): Promise<Partial<KeptSettings>> {
    try {
        const { connectionId, provider, model, effort, mcpServers, verbosity, proactive, paidDataAlwaysAllow } = agentConfigSchema.parse(JSON.parse(await readFile(configPath(FOREMAN_AGENT_ID), 'utf8')))
        return { connectionId, provider, model, effort, mcpServers, verbosity, proactive, paidDataAlwaysAllow }
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
