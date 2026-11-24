import type { ToolSet } from 'ai'
import { filesystemTools } from './builtin/filesystem.js'
import { sharedTools } from './builtin/shared.js'
import { shellTools } from './builtin/shell.js'
import { webTools } from './builtin/web.js'
import { memoryTools } from './builtin/memory.js'
import { dbTools } from './builtin/db.js'
import { sharedDbTools } from './builtin/shared-db.js'
import { brainTools, foremanBrainTools } from './builtin/brain.js'
import { skillTools } from './builtin/skills.js'
import { skillProposeTool } from './builtin/skill-propose.js'
import { selfTools } from './builtin/self.js'
import { scheduleTools } from './builtin/schedule.js'
import { triggerTools } from './builtin/trigger.js'
import { delegateTools } from './builtin/delegate.js'
import { callAgentTools } from './builtin/call-agent.js'
import { teamTools } from './builtin/team.js'
import { aiStatusTools } from './builtin/ai-status.js'
import { browserTools } from './builtin/browser.js'
import { visionTools } from './builtin/vision.js'
import { computerTools, runOffersComputer } from './builtin/computer.js'
import { notifyTools } from './builtin/notify.js'
import { foremanHubTools, hubTools } from './builtin/hub.js'
import { paidDataTools } from './builtin/paid-data.js'
import { paidDataOffered } from '../paid-data/price.js'
import { cardTools } from './builtin/cards.js'
import { askUserTool, offersTakeover, requestApprovalTool, requestFeatureTool, requestSecretTool, requestTakeoverTool, suggestServiceTool } from './builtin/hitl.js'
import { installTools } from './builtin/install.js'
import { foremanTools } from './builtin/foreman.js'
import { reportToMemberTool } from './builtin/checkin.js'
import { agentFilesTools } from './builtin/agent-files.js'
import { hasPendingSetup } from '../agents/setup.js'
import { pooledMcpServers, pooledMcpToolSet } from './mcp-pool.js'
import { capToolSet, toolResultReadTool } from './builtin/tool-result-file.js'
import { MCP_CALL_TOOL, MCP_SEARCH_TOOL, mcpSearchTool, mcpToolCatalog, mcpToolsAreDeferred, type McpCatalogEntry } from './mcp-search.js'
import { mcpCallTool } from './mcp-wire.js'
import { CLI_PROVIDERS } from '../agents/providers.js'
import { closeAgentDb } from '../db/agentDb.js'
import type { RunContext } from '../runtime/context.js'
import { agentMcpServers } from '../vault/runtime.js'
import { remoteComputerTools } from './builtin/remote.js'
import { remoteComputersEnabled } from '../config/env.js'
import { readComputers } from '../remote/store.js'

// What a check-in of the Chief of Staff may call: it reads the workspace and suggests, nothing more.
// A list of names rather than of families, so a tool added to a family later is refused until it is
// named here. Shell, sub-coworkers, calls to coworkers, the browser and the computers, the cards that
// ask someone, every write and the MCP servers stay out, and so do the team, the credit and the
// catalog: a check-in reads them through the hub tools of its brief.
export const CHECKIN_TOOL_NAMES: ReadonlySet<string> = new Set([
    'fs_read',
    'fs_list',
    'fs_search',
    'shared_read',
    'shared_list',
    'shared_search',
    'agent_files_read',
    'agent_files_list',
    'agent_files_search',
    'web_search',
    'web_fetch',
    'tool_result_read',
    'memory_recall',
    'skill_list',
    'skill_read',
    'skill_read_file',
    'brain_search',
    'brain_read',
    'brain_proposals',
    'schedule_list',
    'schedule_get',
    'trigger_list',
    'trigger_get',
    'db_query',
    'db_schema',
    'shared_db_query',
    'shared_db_schema',
    'report_to_member',
])

// The hub tools of a check-in's brief are its own read-only ones, and the token it came with opens
// nothing else on the hub. No board gesture: nobody is watching.
function checkinTools(ctx: RunContext): ToolSet {
    const cfg = ctx.agent.config.tools
    const offered: ToolSet = {
        ...filesystemTools(ctx),
        ...sharedTools(ctx),
        ...agentFilesTools(),
        ...toolResultReadTool(ctx.agent.id),
        ...(cfg.web ? webTools(ctx) : {}),
        ...(cfg.memory ? memoryTools(ctx) : {}),
        ...(cfg.skills ? skillTools(ctx) : {}),
        ...(cfg.brain ? foremanBrainTools() : {}),
        ...(cfg.schedule ? scheduleTools(ctx) : {}),
        ...(cfg.trigger ? triggerTools(ctx) : {}),
        ...(cfg.db ? dbTools(ctx) : {}),
        ...(cfg.sharedDb ? sharedDbTools(ctx) : {}),
        ...reportToMemberTool(ctx),
    }
    if (CLI_PROVIDERS.has(ctx.provider)) delete offered.web_search
    const tools = Object.fromEntries(Object.entries(offered).filter(([name]) => CHECKIN_TOOL_NAMES.has(name)))
    const hubSpecs = new Set((ctx.agent.brief?.tools ?? []).filter(spec => spec.kind === 'hub').map(spec => spec.name))
    for (const [name, hubTool] of Object.entries(foremanTools(ctx))) if (hubSpecs.has(name)) tools[name] = hubTool
    return tools
}

// `heldBackMcp` lists the MCP tools the model is not sent, when the agent's set is too heavy to be.
export async function buildTools(ctx: RunContext): Promise<{ tools: ToolSet; heldBackMcp?: McpCatalogEntry[]; close: () => Promise<void> }> {
    // Capped like any run: what a result leaves out is kept in its own workspace and read back from there.
    if (ctx.readOnly) return { tools: ctx.agent.config.kind === 'foreman' ? capToolSet(checkinTools(ctx), ctx.agent.id) : {}, close: async () => closeAgentDb(ctx.agent.id) }
    const cfg = ctx.agent.config.tools
    const tools: ToolSet = {}
    const accountTools = ctx.agent.config.kind === 'foreman' ? foremanTools(ctx) : {}
    // Called by a coworker it reaches no other coworker's files: only its own, like a coworker.
    Object.assign(tools, accountTools, ctx.agent.config.kind === 'foreman' && !ctx.called ? agentFilesTools() : {})
    if (cfg.filesystem) Object.assign(tools, filesystemTools(ctx))
    if (cfg.shared) Object.assign(tools, sharedTools(ctx))
    if (cfg.shell) Object.assign(tools, shellTools(ctx))
    if (cfg.web) Object.assign(tools, webTools(ctx))
    // A CLI searches with its own tool, on the subscription; see CLAUDE_RUN_TOOLS.
    if (CLI_PROVIDERS.has(ctx.provider)) delete tools.web_search
    if (cfg.memory) Object.assign(tools, memoryTools(ctx))
    if (cfg.db) Object.assign(tools, dbTools(ctx))
    if (cfg.sharedDb) Object.assign(tools, sharedDbTools(ctx))
    // Called by a coworker, nobody of the workspace is behind the Chief of Staff: it proposes to the
    // brain as a coworker does, rather than writing it.
    if (cfg.brain) Object.assign(tools, ctx.agent.config.kind === 'foreman' && !ctx.called ? foremanBrainTools() : brainTools(ctx))
    if (cfg.skills) Object.assign(tools, skillTools(ctx))
    if (cfg.skills && ctx.agent.config.selfImprovement.enabled) Object.assign(tools, skillProposeTool(ctx))
    if (ctx.agent.config.selfImprovement.enabled) Object.assign(tools, selfTools(ctx))
    if (cfg.schedule) Object.assign(tools, scheduleTools(ctx))
    if (cfg.trigger) Object.assign(tools, triggerTools(ctx))
    if (cfg.delegate) Object.assign(tools, delegateTools(ctx))
    if (cfg.callAgent && ctx.callTargets?.length) Object.assign(tools, callAgentTools(ctx))
    if (cfg.team) Object.assign(tools, teamTools(ctx))
    if (cfg.aiProviders) Object.assign(tools, aiStatusTools(ctx))
    if (cfg.browser) Object.assign(tools, browserTools(ctx))
    if (offersTakeover(ctx.agent.config)) Object.assign(tools, requestTakeoverTool(ctx))
    if (cfg.vision) Object.assign(tools, visionTools(ctx))
    const computer = runOffersComputer(ctx.agent.config, ctx.provider, ctx.model, ctx.agent.resolved.connection) ? computerTools(ctx) : null
    if (computer) Object.assign(tools, computer.tools)
    // Only once a computer is linked: a coworker of a workspace without one carries none of these.
    if (cfg.remoteComputers && remoteComputersEnabled() && (await readComputers()).length > 0) Object.assign(tools, remoteComputerTools(ctx))
    if (cfg.notify) Object.assign(tools, notifyTools(ctx))
    if (cfg.hub) Object.assign(tools, ctx.agent.config.kind === 'foreman' ? foremanHubTools(ctx) : hubTools(ctx))
    if (cfg.paidData && (await paidDataOffered())) Object.assign(tools, paidDataTools(ctx))
    if (cfg.cards) Object.assign(tools, cardTools(ctx))
    if (cfg.askUser) Object.assign(tools, askUserTool(ctx))
    if (cfg.requestApproval) Object.assign(tools, requestApprovalTool(ctx))
    if (cfg.suggestService) Object.assign(tools, suggestServiceTool(ctx))
    if (cfg.requestSecret) Object.assign(tools, requestSecretTool(ctx))
    if (ctx.teamRequests) Object.assign(tools, requestFeatureTool(ctx))
    // Only exists while there is an installation to close, so no other agent carries a tool it
    // could never legitimately call.
    if (hasPendingSetup(ctx.agent)) Object.assign(tools, installTools(ctx))
    // Any tool's result can be cut and saved, so the way to read the rest is always there.
    Object.assign(tools, toolResultReadTool(ctx.agent.id))
    // The hub names the foreman's account tools apart from the engine's (coworker_db_query beside
    // db_query): one sharing a name would be replaced here without a word.
    for (const name of Object.keys(accountTools)) if (tools[name] !== accountTools[name]) ctx.logger.warn({ tool: name }, 'an engine tool replaced a foreman account tool of the same name')

    // The connections are the pool's, kept across runs: the run's close leaves them open.
    let heldBackMcp: McpCatalogEntry[] | undefined
    if (!CLI_PROVIDERS.has(ctx.provider) && agentMcpServers(ctx.agent).length > 0) {
        const servers = await pooledMcpServers(ctx.agent)
        const mcpTools = pooledMcpToolSet(servers)
        Object.assign(tools, mcpTools)
        // Too heavy to ride along on every step: the model finds them with a search and runs them
        // through one call, both always in its list.
        if (mcpToolsAreDeferred(mcpTools)) {
            heldBackMcp = mcpToolCatalog(servers).filter(entry => entry.name !== MCP_SEARCH_TOOL && entry.name !== MCP_CALL_TOOL)
            Object.assign(tools, mcpSearchTool(heldBackMcp), mcpCallTool())
        }
    }

    return {
        tools: capToolSet(tools, ctx.agent.id),
        heldBackMcp,
        // The shared database is one handle for the whole process, so it is deliberately left
        // open: closing it here would break a run another agent still has in flight.
        close: async () => {
            computer?.release()
            closeAgentDb(ctx.agent.id)
        },
    }
}
