import { getAgent } from '../../agents/registry.js'
import { probeMcp } from '../../tools/mcp.js'
import { agentMcpSpawn } from '../../tools/mcp-pool.js'
import { clearToken, deviceLogin } from '../../tools/mcp-auth.js'
import { agentMcpServers } from '../../vault/runtime.js'

export async function mcpCommand(args: string[]): Promise<void> {
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
        const servers = agentMcpServers(agent)
        if (servers.length === 0) {
            process.stdout.write('No MCP servers registered.\n')
            return
        }
        for (const server of servers) {
            const probe = await probeMcp(agentId, server, agent.env, { spawn: agentMcpSpawn(agent) })
            const line = probe.ok
                ? `ok\t${server.name}\t${probe.transport}\t${probe.toolNames.length} tools`
                : `fail\t${server.name}\t${probe.transport}\t${probe.error}`
            process.stdout.write(`${line}\n`)
        }
        return
    }
    throw new Error('Usage: rerun mcp <login|logout|status>')
}
