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
import { hubTools } from './builtin/hub.js'
import { paidDataTools } from './builtin/paid-data.js'
import { paidDataOffered } from '../paid-data/price.js'
import { cardTools, foremanCardTools } from './builtin/cards.js'
import { askUserTool, offersTakeover, requestApprovalTool, requestSecretTool, requestTakeoverTool, suggestServiceTool } from './builtin/hitl.js'
import { installTools } from './builtin/install.js'
import { foremanTools } from './builtin/foreman.js'
import { agentFilesTools } from './builtin/agent-files.js'
import { hasPendingSetup } from '../agents/setup.js'
import { pooledMcpTools } from './mcp-pool.js'
import { CLI_PROVIDERS } from '../agents/providers.js'
import { closeAgentDb } from '../db/agentDb.js'
import type { RunContext } from '../runtime/context.js'
import { agentMcpServers } from '../vault/runtime.js'

export async function buildTools(ctx: RunContext): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
    const cfg = ctx.agent.config.tools
    const tools: ToolSet = {}
    if (ctx.agent.config.kind === 'foreman') Object.assign(tools, foremanTools(ctx), agentFilesTools())
    if (cfg.filesystem) Object.assign(tools, filesystemTools(ctx))
    if (cfg.shared) Object.assign(tools, sharedTools(ctx))
    if (cfg.shell) Object.assign(tools, shellTools(ctx))
    if (cfg.web) Object.assign(tools, webTools(ctx))
    // A CLI searches with its own tool, on the subscription; see CLAUDE_RUN_TOOLS.
    if (CLI_PROVIDERS.has(ctx.provider)) delete tools.web_search
    if (cfg.memory) Object.assign(tools, memoryTools(ctx))
    if (cfg.db) Object.assign(tools, dbTools(ctx))
    if (cfg.sharedDb) Object.assign(tools, sharedDbTools(ctx))
    if (cfg.brain) Object.assign(tools, ctx.agent.config.kind === 'foreman' ? foremanBrainTools() : brainTools(ctx))
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
    if (cfg.notify) Object.assign(tools, notifyTools(ctx))
    if (cfg.hub) Object.assign(tools, hubTools(ctx))
    if (cfg.paidData && (await paidDataOffered())) Object.assign(tools, paidDataTools(ctx))
    if (cfg.cards) Object.assign(tools, ctx.agent.config.kind === 'foreman' ? foremanCardTools(ctx) : cardTools(ctx))
    if (cfg.askUser) Object.assign(tools, askUserTool(ctx))
    if (cfg.requestApproval) Object.assign(tools, requestApprovalTool(ctx))
    if (cfg.suggestService) Object.assign(tools, suggestServiceTool(ctx))
    if (cfg.requestSecret) Object.assign(tools, requestSecretTool(ctx))
    // Only exists while there is an installation to close, so no other agent carries a tool it
    // could never legitimately call.
    if (hasPendingSetup(ctx.agent)) Object.assign(tools, installTools(ctx))

    // The connections are the pool's, kept across runs: the run's close leaves them open.
    if (!CLI_PROVIDERS.has(ctx.provider) && agentMcpServers(ctx.agent).length > 0) Object.assign(tools, await pooledMcpTools(ctx.agent))

    return {
        tools,
        // The shared database is one handle for the whole process, so it is deliberately left
        // open: closing it here would break a run another agent still has in flight.
        close: async () => {
            computer?.release()
            closeAgentDb(ctx.agent.id)
        },
    }
}
