import { getAgent } from '../../agents/registry.js'
import { probeMcp } from '../../tools/mcp.js'
import { agentMcpSpawn } from '../../tools/mcp-pool.js'
import { clearToken, deviceLogin } from '../../tools/mcp-auth.js'
import { listAgentIdsOnDisk, readAgentConfig } from '../../agents/loader.js'
import { mergeMcpServers, writeAgentConfig } from '../../agents/config-write.js'
import { mcpServerSchema } from '../../agents/types.js'

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
}

export async function mcpCommand(args: string[], readAll: () => Promise<string> = readStdin): Promise<void> {
    const sub = args[0]
    if (sub === 'login') {
        const [, agentId, name] = args
        if (!agentId || !name) throw new Error('Usage: rerun mcp login <agentId> <server>')
        const agent = await getAgent(agentId)
        const server = agent.config.mcpServers.find(s => s.name === name)
        if (!server) throw new Error(`No MCP server "${name}" registered for agent ${agentId}`)
        await deviceLogin(agentId, server, start => {
            process.stdout.write(`\nOpen this URL and sign in:\n  ${start.verificationUri}\n\nWaiting for authorization`)
        })
        process.stdout.write(`\nSigned in to ${name}. Token stored.\n`)
        return
    }
    if (sub === 'logout') {
        const [, agentId, name] = args
        if (!agentId || !name) throw new Error('Usage: rerun mcp logout <agentId> <server>')
        await clearToken(agentId, name)
        process.stdout.write(`Cleared stored token for ${name}.\n`)
        return
    }
    if (sub === 'status') {
        const [, agentId] = args
        if (!agentId) throw new Error('Usage: rerun mcp status <agentId>')
        const agent = await getAgent(agentId)
        if (agent.config.mcpServers.length === 0) {
            process.stdout.write('No MCP servers registered.\n')
            return
        }
        for (const server of agent.config.mcpServers) {
            const probe = await probeMcp(agentId, server, agent.env, { spawn: agentMcpSpawn(agent) })
            const line = probe.ok
                ? `ok\t${server.name}\t${probe.transport}\t${probe.toolNames.length} tools`
                : `fail\t${server.name}\t${probe.transport}\t${probe.error}`
            process.stdout.write(`${line}\n`)
        }
        return
    }
    if (sub === 'set-all') {
        const [, name, ...extra] = args
        if (!name || extra.length > 0) throw new Error('Usage: rerun mcp set-all <server>  (the definition is read as JSON from stdin)')
        const def = parseServerDefinition(name, await readAll())
        const ids = await listAgentIdsOnDisk()
        let had = 0
        for (const id of ids) {
            const config = await readAgentConfig(id)
            if (!config.mcpServers.some(s => s.name === name)) continue
            await writeAgentConfig(id, { ...config, mcpServers: mergeMcpServers(config.mcpServers, { upsert: [def] }) })
            process.stdout.write(`updated ${id}\n`)
            had++
        }
        process.stdout.write(`${had} of ${ids.length} coworkers had ${name}; restart the engine so running coworkers pick it up.\n`)
        return
    }
    throw new Error('Usage: rerun mcp <login|logout|status|set-all>')
}

function parseServerDefinition(name: string, text: string) {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error('The definition on stdin is not valid JSON; nothing written.')
    }
    const result = mcpServerSchema.safeParse(parsed)
    if (!result.success) throw new Error('The definition on stdin is not a valid MCP server; nothing written.')
    if (result.data.name !== name) throw new Error(`The definition is named "${result.data.name}", not "${name}"; nothing written.`)
    return result.data
}
