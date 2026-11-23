import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { RunContext } from '../../runtime/context.js'
import { callHub } from '../../runtime/hub.js'

const agentId = z.string().describe('The coworker id, as team_status returns it.')

// Read-only by construction: the hub answers these names and nothing that writes.
export function teamTools(ctx: RunContext): ToolSet {
    const call = (name: string, args: Record<string, unknown>) => callHub(ctx.agent, name, args)
    return {
        team_status: tool({
            description: 'See every coworker (not the Chief of Staff) right now: id, name, handle, status (working, waiting_human, error, idle, offline, switched_off, unconfigured), runs in flight, conversations waiting on a person, and the last finished run with its error. Start here to audit the team. Read-only.',
            inputSchema: z.object({ agentId: agentId.optional().describe('Optional: restrict to one coworker.') }),
            execute: args => call('team_status', args),
        }),
        team_list_schedules: tool({
            description: "Read another coworker's scheduled tasks in full: name, instruction, cron or date, enabled state and last run. Read-only.",
            inputSchema: z.object({ agentId }),
            execute: args => call('team_list_schedules', args),
        }),
        team_list_triggers: tool({
            description: "Read another coworker's webhook triggers: name, instruction, methods, enabled state, fire count and last fire. Read-only, the webhook URLs are not shared.",
            inputSchema: z.object({ agentId }),
            execute: args => call('team_list_triggers', args),
        }),
        team_list_runs: tool({
            description: "Another coworker's recent runs, newest first: status, what triggered them, start and end, model, cost and error. Use it to check that a scheduled task ran. A run marked done only ended without a technical error: read its output with team_get_run before saying the task worked. Read-only.",
            inputSchema: z.object({ agentId, limit: z.number().optional().describe('Default 20, max 200.') }),
            execute: args => call('team_list_runs', args),
        }),
        team_get_run: tool({
            description: 'One run of another coworker: final output, status, error and cost. Set includeToolCalls only to diagnose a failure: it adds every tool the coworker called, each input and result cut at 2,000 characters, and can carry data from its connected apps. Read-only.',
            inputSchema: z.object({ agentId, runId: z.string(), includeToolCalls: z.boolean().optional() }),
            execute: args => call('team_get_run', args),
        }),
    }
}
