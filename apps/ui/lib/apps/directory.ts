import { bareToolName } from '@rerun/contracts'
import { APP_LIST_TOOLS, APP_RUN_TOOL, type AppInfo } from './catalog'
import { accountNames, type AgentConnection } from './connections'
import { missingRequired, toolParams, type AppScope, type AppTool } from './tools'

// A paid app has more tools than a coworker should carry on every run. It loads the everyday ones,
// and reads the rest from a directory, one scope at a time, the way paid_data reads its catalog:
// list_tools gives a scope's tools with their parameters, run_tool runs one of them.

type AppDirectory = Pick<AppInfo, 'name' | 'serverName'> & { tools: AppTool[]; scopes: Record<string, AppScope>; quotaPace(action: string): string }

type ListedTool = Pick<AppTool, 'name' | 'description' | 'inputSchema'>

export type RunToolCall = { tool: AppTool; args: Record<string, unknown> } | { refusal: string }

const loadedAs = (app: AppDirectory, name: string) => `${app.serverName}_${name}`

const toolsOf = (app: AppDirectory, scope: string) => app.tools.filter(tool => tool.scope === scope)

function scopeIndex(app: AppDirectory) {
    return Object.entries(app.scopes).map(([scope, { summary, requires }]) => ({ scope, tools: toolsOf(app, scope).length, summary, ...(requires ? { requires } : {}) }))
}

function listed(app: AppDirectory) {
    return ({ name, description, inputSchema, quota }: AppTool): ListedTool => ({ name, description: quota ? `${description} ${app.quotaPace(quota.action)}` : description, inputSchema })
}

const ACCOUNT_PARAM = 'account'

// Only for a coworker that holds several accounts: with one, there is nothing to name.
function withAccount(accounts: AgentConnection[]) {
    return (tool: ListedTool): ListedTool => {
        if (accounts.length < 2 || tool.name === APP_LIST_TOOLS) return tool
        const account = { type: 'string', description: `Which of your accounts acts, one of: ${accountNames(accounts)}. Ask the user when they have not said which one.` }
        return { ...tool, inputSchema: { ...tool.inputSchema, properties: { [ACCOUNT_PARAM]: account, ...tool.inputSchema.properties }, required: [ACCOUNT_PARAM, ...(tool.inputSchema.required ?? [])] } }
    }
}

export function listedTools(app: AppDirectory, accounts: AgentConnection[] = []): ListedTool[] {
    const scopes = scopeIndex(app)
        .map(({ scope, tools, summary, requires }) => `- ${scope} (${tools} tools${requires ? `, needs ${requires}` : ''}): ${summary}`)
        .join('\n')
    const tools: ListedTool[] = [
        ...app.tools.filter(tool => !tool.scope).map(listed(app)),
        {
            name: APP_LIST_TOOLS,
            description: `The ${app.name} tools that are not loaded, by scope. Free: nothing is sent, nothing counts toward a daily pace. Call it with a scope before the first task that needs it: it gives each tool of that scope, what it does and its parameters. Then run one with ${loadedAs(app, APP_RUN_TOOL)}. Scopes:\n${scopes}`,
            inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: Object.keys(app.scopes) } } },
        },
        {
            name: APP_RUN_TOOL,
            description: `Run a ${app.name} tool read in ${loadedAs(app, APP_LIST_TOOLS)}, on the same account and with the same recommended daily pace as the loaded tools. Read its scope first: a tool or a parameter the scope does not list is refused.`,
            inputSchema: {
                type: 'object',
                properties: {
                    tool: { type: 'string', description: `The tool name as its scope lists it, e.g. ${app.tools.find(tool => tool.scope)?.name}` },
                    arguments: { type: 'object', description: 'The parameters of that tool' },
                },
                required: ['tool'],
            },
        },
    ]
    return tools.map(withAccount(accounts))
}

// The account a call names, and the call without it: no tool has such a parameter. Some models lay it
// among the parameters of a tool they run by name.
export function takeAccount(call: Record<string, unknown>): { account: string | null; call: Record<string, unknown> } {
    const { [ACCOUNT_PARAM]: beside, ...rest } = call
    const nested = argumentsOf(rest.arguments)
    const inside = nested?.[ACCOUNT_PARAM]
    if (nested && inside !== undefined) rest.arguments = Object.fromEntries(Object.entries(nested).filter(([key]) => key !== ACCOUNT_PARAM))
    const named = [beside, inside].find(value => typeof value === 'string' && value.trim())
    return { account: typeof named === 'string' ? named.trim() : null, call: rest }
}

export function readDirectory(app: AppDirectory, scope: unknown) {
    const entry = typeof scope === 'string' ? app.scopes[scope] : undefined
    if (typeof scope !== 'string' || !entry) {
        return { ...(scope === undefined ? {} : { error: `Unknown scope "${String(scope)}".` }), scopes: scopeIndex(app), next: `Call ${loadedAs(app, APP_LIST_TOOLS)} with one of these scopes.` }
    }
    return {
        scope,
        ...(entry.requires ? { requires: entry.requires } : {}),
        run_with: `${loadedAs(app, APP_RUN_TOOL)}, the name as tool and the parameters as arguments`,
        tools: toolsOf(app, scope).map(listed(app)),
    }
}

function argumentsOf(value: unknown): Record<string, unknown> | null {
    if (value === undefined || value === null) return {}
    let parsed = value
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value)
        } catch {
            return null
        }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

// The model's provider checks a loaded tool's arguments against its schema; a tool run by name has
// only this check, so a parameter it does not take is refused instead of silently dropped.
export function resolveRunTool(app: AppDirectory, call: Record<string, unknown>): RunToolCall {
    const asked = typeof call.tool === 'string' ? call.tool.trim() : ''
    const name = bareToolName(asked, app.serverName)
    const tool = app.tools.find(candidate => candidate.name === name)
    if (!tool) {
        return { refusal: `${asked ? `Unknown tool "${asked}"` : 'No tool was named'}. Nothing was run. Read a scope with ${loadedAs(app, APP_LIST_TOOLS)} for its tool names: ${Object.keys(app.scopes).join(', ')}.` }
    }

    const required = new Set(tool.inputSchema.required ?? [])
    const declared = Object.keys(tool.inputSchema.properties)
    const takes = declared.length > 0 ? `It takes ${declared.map(key => (required.has(key) ? `${key} (required)` : key)).join(', ')}.` : 'It takes no parameter.'

    // Some models lay the parameters beside `tool` instead of under `arguments`.
    const args = call.arguments === undefined ? Object.fromEntries(Object.entries(call).filter(([key]) => key !== 'tool')) : argumentsOf(call.arguments)
    if (!args) return { refusal: `The arguments of ${name} must be an object. Nothing was run. ${takes}` }
    const unknown = Object.keys(args).filter(key => !declared.includes(key))
    if (unknown.length > 0) return { refusal: `${name} has no parameter ${unknown.join(', ')}. Nothing was run. ${takes}` }
    const missing = missingRequired(tool, toolParams(tool, args))
    if (missing.length > 0) return { refusal: `Missing ${missing.join(', ')}. Nothing was run. ${takes}` }
    return { tool, args }
}
