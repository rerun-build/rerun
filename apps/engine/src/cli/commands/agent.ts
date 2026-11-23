import { agentKindOfEngineId, agentKindPolicy } from '@rerun/contracts'
import { rm } from 'node:fs/promises'
import { prepareDataDir } from '../../datadir/ladder.js'
import { createAgent } from '../../agents/factory.js'
import { listAgentIndex, deleteAgentIndex } from '../../db/repos/agents.js'
import { agentExists } from '../../agents/loader.js'
import { agentDir } from '../../config/paths.js'
import { unloadAgent } from '../../agents/registry.js'

function parseFlags(args: string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2)
            out[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true'
        }
    }
    return out
}

export async function agentCommand(args: string[]): Promise<void> {
    await prepareDataDir()
    const sub = args[0]
    const flags = parseFlags(args.slice(1))

    if (sub === 'create') {
        if (!flags.name) throw new Error('Usage: rerun agent create --name <name> [--provider anthropic] [--model <id>] [--key ANTHROPIC_API_KEY=...]')
        const keys: Record<string, string> = {}
        if (flags.key) {
            const eq = flags.key.indexOf('=')
            keys[flags.key.slice(0, eq)] = flags.key.slice(eq + 1)
        }
        const agent = await createAgent({ config: { name: flags.name, provider: (flags.provider as never) ?? undefined, model: flags.model ?? undefined }, keys })
        process.stdout.write(`Created agent ${agent.id} (${agent.config.name})\n`)
        return
    }

    if (sub === 'list') {
        const agents = await listAgentIndex()
        for (const a of agents) process.stdout.write(`${a.id}\t${a.status}\t${a.name}\n`)
        return
    }

    if (sub === 'delete') {
        const id = args[1]
        if (!id || !agentExists(id)) throw new Error('Usage: rerun agent delete <id>')
        if (!agentKindPolicy(agentKindOfEngineId(id)).deletable) throw new Error('The foreman is managed by the engine and cannot be deleted')
        unloadAgent(id)
        await deleteAgentIndex(id)
        await rm(agentDir(id), { recursive: true, force: true })
        process.stdout.write(`Deleted ${id}\n`)
        return
    }

    throw new Error('Usage: rerun agent <create|list|delete>')
}
