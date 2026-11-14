import type { EngineConnection } from '@/lib/engine/types'
import type { LinkupCategory } from './linkup/client'
import type { AppSlug } from './types'

// A paid app's tools, chosen one by one rather than relayed from Linkup's catalogue: no login, no
// account deletion, no webhooks. Each maps onto one Linkup action, with only the parameters its
// schema lists passed on, unless it brings its own `run`.

type JsonSchema = { type: 'object'; properties: Record<string, Record<string, unknown>>; required?: string[] }

export type AppToolContext = {
    slug: AppSlug
    accountId: string
    connectionId: string
    engineAgentId: string
    engine: () => Promise<EngineConnection>
}

// What a `run` throws for the coworker to read, as opposed to a failure of the hub itself.
export class AppToolRefusal extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AppToolRefusal'
    }
}

// One entry of an app's directory: the tools a coworker reads on demand instead of carrying them on
// every run.
export type AppScope = { summary: string; requires?: string }

export type AppTool<Q extends string = string, S extends string = string> = {
    name: string
    // Without a scope the tool is loaded on every run; with one it is read from the directory.
    scope?: S
    description: string
    inputSchema: JsonSchema
    category: LinkupCategory
    action: string
    quota?: { action: Q; amount?: (args: Record<string, unknown>) => number }
    // A second limit the call may count against, which only the account itself can tell: a first
    // message to a WhatsApp number is a new conversation, a reply is not.
    extraQuota?: (accountId: string, params: Record<string, unknown>) => Promise<Q | null>
    // Defaults and caps applied after the agent's arguments, so an agent cannot ask for a page of
    // a thousand profiles in one call.
    clamp?: Record<string, { default: number; max: number }>
    // A tool that is more than one Linkup action, run by the hub in place of `action`.
    run?: (context: AppToolContext, params: Record<string, unknown>) => Promise<unknown>
}

// Keeps the declared parameters only, and holds counts inside their caps.
export function toolParams(tool: AppTool, args: Record<string, unknown>): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    for (const key of Object.keys(tool.inputSchema.properties)) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') params[key] = args[key]
    }
    for (const [key, { default: fallback, max }] of Object.entries(tool.clamp ?? {})) {
        const value = Number(params[key])
        params[key] = Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback
    }
    return params
}

export function missingRequired(tool: AppTool, params: Record<string, unknown>): string[] {
    return (tool.inputSchema.required ?? []).filter(key => params[key] === undefined)
}
