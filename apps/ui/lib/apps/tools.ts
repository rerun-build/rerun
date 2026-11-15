import type { EngineConnection } from '@/lib/engine/types'
import type { LinkupCategory } from './linkup/client'
import type { AppSlug } from './types'

type JsonSchema = { type: 'object'; properties: Record<string, Record<string, unknown>>; required?: string[] }

export type AppToolContext = {
    slug: AppSlug
    accountId: string
    connectionId: string
    engineAgentId: string
    engine: () => Promise<EngineConnection>
}

export class AppToolRefusal extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AppToolRefusal'
    }
}

export type AppTool<Q extends string = string> = {
    name: string
    description: string
    inputSchema: JsonSchema
    category: LinkupCategory
    action: string
    quota?: { action: Q; amount?: (args: Record<string, unknown>) => number }
    extraQuota?: (accountId: string, params: Record<string, unknown>) => Promise<Q | null>
    clamp?: Record<string, { default: number; max: number }>
    run?: (context: AppToolContext, params: Record<string, unknown>) => Promise<unknown>
}

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
