import { type ToolSet } from 'ai'
import { z } from 'zod'
import { makeFsTools } from './fsTools.js'
import { workspaceDir } from '../../config/paths.js'
import { listAgentIndex } from '../../db/repos/agents.js'

export async function agentWorkspaceOf(ref: string): Promise<string> {
    const wanted = ref.trim().replace(/^@/, '')
    const agents = (await listAgentIndex()).filter(agent => !agent.name.endsWith(' delegate'))
    const match = agents.find(agent => agent.id === wanted) ?? agents.find(agent => agent.name === wanted)
    if (!match) throw new Error(`No coworker "${ref}" on this workspace. Known handles: ${agents.map(agent => `@${agent.name}`).join(', ') || 'none'}.`)
    return workspaceDir(match.id)
}

export function agentFilesTools(): ToolSet {
    return makeFsTools({
        prefix: 'agent_files',
        label: 'workspace of one of the coworkers of this workspace',
        scope: { agent: z.string().describe('The coworker whose workspace to use: its handle, with or without @') },
        rootDir: input => agentWorkspaceOf(String(input.agent)),
    })
}
