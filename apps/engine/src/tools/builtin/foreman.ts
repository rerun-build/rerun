import { FOREMAN_INTENT_PART, type ForemanToolSpec } from '@rerun/contracts'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { RunContext } from '../../runtime/context.js'
import { callHub } from '../../runtime/hub.js'
import { HITL_TOOL_SET } from './hitl.js'

// `send_message` waits on the agent it wrote to, and the first Box of a workspace claims a machine:
// both routinely outlast the 20 s the service-catalog calls get.
const FOREMAN_HUB_TIMEOUT_MS = 180_000

let serialTail: Promise<unknown> = Promise.resolve()

function runSerially<T>(task: () => Promise<T>): Promise<T> {
    const next = serialTail.then(task, task)
    serialTail = next.catch(() => {})
    return next
}

// The CLI bridge only exposes tools whose input schema is zod, so the JSON Schema the hub sends
// is converted rather than wrapped. A schema zod cannot read drops that one tool, not the run.
function inputSchemaOf(spec: ForemanToolSpec, ctx: RunContext): z.ZodType | null {
    try {
        return z.fromJSONSchema(spec.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    } catch (err) {
        ctx.logger.warn({ tool: spec.name, err: String(err) }, 'foreman tool schema rejected')
        return null
    }
}

function hubTool(spec: ForemanToolSpec, inputSchema: z.ZodType, ctx: RunContext) {
    const call = (args: unknown) => callHub(ctx.agent, spec.name, (args ?? {}) as Record<string, unknown>, FOREMAN_HUB_TIMEOUT_MS)
    return tool({
        description: spec.description,
        inputSchema,
        execute: args => (spec.serial ? runSerially(() => call(args)) : call(args)),
    })
}

// Transient, so the gesture reaches the open browser once and is gone: a reload must not reopen
// every panel the foreman ever pointed at.
function intentTool(spec: ForemanToolSpec, inputSchema: z.ZodType, ctx: RunContext) {
    return tool({
        description: spec.description,
        inputSchema,
        execute: async input => {
            if (!ctx.writer) return { ok: false, error: 'No browser is watching this conversation.' }
            ctx.writer.write({ type: FOREMAN_INTENT_PART, data: { tool: spec.name, input }, transient: true })
            return { ok: true }
        },
    })
}

// An engine tool of the foreman's that only a client of the same age can draw: the hub names it in
// the brief once the box says it has it, so a hub that predates it never sees a card it cannot show.
export function briefNamesBuiltin(agent: Pick<RunContext['agent'], 'brief'>, name: string): boolean {
    return agent.brief?.builtins?.includes(name) ?? false
}

export function foremanTools(ctx: RunContext): ToolSet {
    const tools: ToolSet = {}
    for (const spec of ctx.agent.brief?.tools ?? []) {
        if (HITL_TOOL_SET.has(spec.name)) continue
        const inputSchema = inputSchemaOf(spec, ctx)
        if (!inputSchema) continue
        tools[spec.name] = spec.kind === 'intent' ? intentTool(spec, inputSchema, ctx) : hubTool(spec, inputSchema, ctx)
    }
    return tools
}
