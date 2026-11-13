import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { configPath, soulPath, workspaceDir } from '../../config/paths.js'
import { agentConfigSchema, mcpServerSchema, verbositySchema, BRIDGE_SERVER_NAME, MCP_SERVER_NAME_RE, type McpServer } from '../../agents/types.js'
import { reloadAgent } from '../../agents/registry.js'
import { withAgentLock } from '../../agents/lock.js'
import { writeAgentConfig, mergeMcpServers, ReservedMcpServerNameError, InvalidMcpServerNameError } from '../../agents/config-write.js'
import { mcpToolNameFor, probeMcp } from '../mcp.js'
import { agentMcpSpawn } from '../mcp-pool.js'
import { agentConnectorStates, describeConnectorState } from '../mcp-index.js'
import { agentMcpServers } from '../../vault/runtime.js'
import {
    clearPending,
    discoverDeviceAuth,
    isAuthError,
    loadPending,
    pollDeviceToken,
    savePending,
    saveToken,
    startDeviceFlow,
} from '../mcp-auth.js'
import type { RunContext } from '../../runtime/context.js'
import { mcpSignInTool } from './hitl.js'

const run = promisify(execFile)

// A server dialed with a key the user gave is not asking for a sign-in when it answers 401: it is
// turning that key down, and only a new value will fix it. The key can sit in any field
// resolveServerSecrets fills in.
function serverCarriesCredential(server: McpServer): boolean {
    const holdsPlaceholder = (value: string | undefined) => value?.includes('${') === true
    return Object.keys(server.headers).length > 0 || holdsPlaceholder(server.url) || holdsPlaceholder(server.command) || server.args.some(holdsPlaceholder)
}

// A server of the workspace's Vault is signed in from the Vault, once for every coworker using it:
// a device sign-in here would land in this coworker's folder, where nothing reads it.
function vaultServerNote(name: string, agent: RunContext['agent']): string | null {
    const server = agentMcpServers(agent).find(candidate => candidate.name === name && candidate.vaultItemId)
    return server ? `"${name}" comes from the workspace's Vault and is shared with other coworkers. Ask the user to reconnect it from the Vault (workspace menu, Vault); you cannot sign it in yourself.` : null
}

export function selfTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id
    const modelToolNames = (serverName: string, toolNames: string[]) => toolNames.map(toolName => mcpToolNameFor(ctx.provider, serverName, toolName)).join(', ')
    const si = ctx.agent.config.selfImprovement
    const tools: ToolSet = {}
    if (si.allowSoulEdit) {
        tools.soul_update = tool({
            description:
                'Rewrite your SOUL.md — the identity, mission and voice at the top of your system prompt. Your current soul is already shown to you there; produce the full updated version (not a diff). Use this to durably evolve who you are as you learn from the user. The new soul takes effect from your next message onward. For facts and procedures use memory_write instead; reserve this for genuine changes to your identity or mission.',
            inputSchema: z.object({
                soul: z.string().trim().min(1).describe('The complete new SOUL.md content in Markdown, replacing the previous one'),
                reason: z.string().describe('One sentence on what changed and why, for the user to see'),
            }),
            execute: async ({ soul, reason }) => {
                await writeFile(soulPath(id), `${soul.trim()}\n`, 'utf8')
                await reloadAgent(id)
                return `Soul updated (${reason}). It takes effect from your next message onward.`
            },
        })
    }
    tools.verbosity_set = tool({
        description:
            'Change how long your answers to this user are, for good. Levels are minimal (one or two sentences), concise (the result and what changes a decision), normal (your native behaviour) and detailed (reasoning, alternatives and caveats spelled out). Use it when the user asks for durably shorter or longer answers, or once they have agreed to a change you proposed. It only moves the length of your prose: the work, the checks and the deliverables stay the same.',
        inputSchema: z.object({
            level: verbositySchema.describe('The new response length'),
            reason: z.string().describe('One sentence on why it changed, for the user to see'),
        }),
        execute: async ({ level, reason }) => {
            await withAgentLock(id, async () => {
                const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
                config.verbosity = level
                await writeAgentConfig(id, config)
                await reloadAgent(id)
            })
            return `Response length set to ${level} (${reason}). It takes effect from your next message onward.`
        },
    })
    if (!si.allowToolInstall) return tools
    Object.assign(tools, {
        tool_install: tool({
            description: 'Install an npm package into your workspace so you can use it via shell. Use to add capabilities you need.',
            inputSchema: z.object({ packages: z.array(z.string()).min(1).describe('npm package names') }),
            execute: async ({ packages }) => {
                const flag = packages.find(name => name.startsWith('-'))
                if (flag) return `Install refused: ${flag} is not a package name.`
                const cwd = workspaceDir(id)
                try {
                    const { stdout, stderr } = await run('npm', ['install', '--no-fund', '--no-audit', '--', ...packages], { cwd, timeout: 300_000, maxBuffer: 10_000_000 })
                    return `Installed ${packages.join(', ')}\n${stdout}${stderr ? `\n${stderr}` : ''}`.slice(0, 20_000)
                } catch (e) {
                    return `Install failed: ${(e as Error).message}`.slice(0, 20_000)
                }
            },
        }),
        mcp_register: tool({
            description: 'Register an MCP server, verifying it actually connects before saving. Supports stdio (command), sse and http (url). Transport is auto-detected from the url/command if omitted. Pass headers for bearer-token auth. Never inline a raw credential: reference a coworker variable as ${KEY} in a header, url or arg (e.g. "Authorization": "Bearer ${LINEAR_API_KEY}") and it is resolved at connect time. Get the value into that variable by calling request_secret first, so the secret never passes through the conversation.',
            inputSchema: z.object({
                name: z.string(),
                transport: z.enum(['stdio', 'sse', 'http']).optional(),
                command: z.string().optional(),
                args: z.array(z.string()).default([]),
                url: z.string().optional(),
                headers: z.record(z.string(), z.string()).default({}).describe('HTTP headers for auth, e.g. { "Authorization": "Bearer <token>" }'),
            }),
            execute: async input => {
                const server = mcpServerSchema.parse({ ...input, env: {} })
                if (server.name === BRIDGE_SERVER_NAME) return `${new ReservedMcpServerNameError().message}\nNothing was saved.`
                if (!MCP_SERVER_NAME_RE.test(server.name)) return `${new InvalidMcpServerNameError(server.name).message}\nNothing was saved.`
                // A server the Vault lends under this name would hide the one registered here.
                if (agentMcpServers(ctx.agent).some(candidate => candidate.name === server.name && candidate.vaultItemId)) {
                    return `"${server.name}" is already the name of a server this coworker gets from the workspace's Vault. Register it under another name.\nNothing was saved.`
                }
                const probe = await probeMcp(id, server, ctx.agent.env, { spawn: agentMcpSpawn(ctx.agent) })
                const needsLogin = !probe.ok && isAuthError(probe.error)
                if (needsLogin && serverCarriesCredential(server)) {
                    return `Could not connect to MCP server "${server.name}" via ${probe.transport}: the server rejected the credentials: ${probe.error}\nNothing was saved. Ask the user for a valid value with request_secret, then register it again.`
                }
                if (!probe.ok && !needsLogin) {
                    return `Could not connect to MCP server "${server.name}" via ${probe.transport}: ${probe.error}\nNothing was saved. Fix the url, transport, or auth headers and try again.`
                }
                await withAgentLock(id, async () => {
                    const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
                    config.mcpServers = mergeMcpServers(config.mcpServers, { upsert: [server] })
                    await writeAgentConfig(id, config)
                    await reloadAgent(id)
                })
                if (needsLogin) {
                    return `Registered MCP server "${server.name}" (${probe.transport}), but it requires sign-in. Call request_mcp_sign_in with name "${server.name}" now, in the same message, and end your turn: the user gets a Connect card and you continue from their reply. Do not describe the sign-in steps yourself. Only if they skip it or say they cannot sign in, call mcp_login with name "${server.name}".`
                }
                return `Connected and registered MCP server "${server.name}" (${probe.transport}). ${probe.toolNames.length} tools now available: ${modelToolNames(server.name, probe.toolNames)}. They are active from your next message onward, no restart needed.`
            },
        }),
        mcp_login: tool({
            description: 'Start OAuth device-code sign-in for a registered MCP server. Returns a URL for the user to open in their browser. After they confirm they signed in, call mcp_login_complete.',
            inputSchema: z.object({ name: z.string() }),
            execute: async ({ name }) => {
                const fromVault = vaultServerNote(name, ctx.agent)
                if (fromVault) return fromVault
                const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
                const server = config.mcpServers.find(s => s.name === name)
                if (!server) return `No MCP server named "${name}" is registered. Register it first with mcp_register.`
                if (!server.url) return `Server "${name}" is stdio-based and does not use OAuth sign-in.`
                try {
                    const auth = await discoverDeviceAuth(server.url)
                    const start = await startDeviceFlow(auth)
                    await savePending(id, name, { auth, start, startedAt: Date.now() })
                    const minutes = Math.round(start.expiresIn / 60)
                    return `Ask the user to open this URL and sign in to "${name}":\n${start.verificationUri}\nThe link is valid for about ${minutes} minutes. Once the user confirms they have signed in, call mcp_login_complete with name "${name}".`
                } catch (e) {
                    return `Could not start sign-in for "${name}": ${(e as Error).message}`
                }
            },
        }),
        mcp_login_complete: tool({
            description: 'Finish a pending MCP device-code sign-in started with mcp_login. Call this only after the user confirms they have signed in via the URL.',
            inputSchema: z.object({ name: z.string() }),
            execute: async ({ name }) => {
                const fromVault = vaultServerNote(name, ctx.agent)
                if (fromVault) return fromVault
                const pending = await loadPending(id, name)
                if (!pending) return `No pending sign-in for "${name}". Call mcp_login first.`
                try {
                    const token = await pollDeviceToken(pending.auth, pending.start, { maxWaitMs: 120_000 })
                    await saveToken(id, name, token)
                    await clearPending(id, name)
                    await reloadAgent(id)
                    const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
                    const server = config.mcpServers.find(s => s.name === name)
                    if (!server) return `Signed in to "${name}", but it is no longer registered.`
                    const probe = await probeMcp(id, server, ctx.agent.env, { spawn: agentMcpSpawn(ctx.agent) })
                    return probe.ok
                        ? `Signed in to "${name}". ${probe.toolNames.length} tools now available: ${modelToolNames(name, probe.toolNames)}. Active from your next message onward.`
                        : `Signed in to "${name}", but the connection still failed: ${probe.error}`
                } catch (e) {
                    return `Sign-in not finished for "${name}": ${(e as Error).message}`
                }
            },
        }),
        mcp_status: tool({
            description: 'Check the live connection status and available tools of your registered MCP servers.',
            inputSchema: z.object({}),
            execute: async () => {
                const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
                const servers = agentMcpServers({ ...ctx.agent, config })
                if (servers.length === 0) return 'No MCP servers registered.'
                const states = await agentConnectorStates(ctx.agent)
                const lines = await Promise.all(
                    servers.map(async server => {
                        const state = states.get(server.name)
                        if (state && state.status !== 'active') {
                            return `not connected yet ${server.name}: ${describeConnectorState(state, states)} is waiting for the user to connect it (suggest_service), every call to its tools fails until then`
                        }
                        const probe = await probeMcp(id, server, ctx.agent.env, { spawn: agentMcpSpawn(ctx.agent) })
                        return probe.ok
                            ? `connected ${server.name} (${probe.transport}): ${probe.toolNames.length} tools — ${modelToolNames(server.name, probe.toolNames)}`
                            : `failed ${server.name} (${probe.transport}): ${probe.error}`
                    }),
                )
                return lines.join('\n')
            },
        }),
    }, mcpSignInTool(ctx))
    return tools
}
