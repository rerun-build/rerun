export type ManagedToolDef = {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

export type ManagedTool = ManagedToolDef & {
    execute: (args: Record<string, unknown>, accessToken: string) => Promise<unknown>
}

export type ManagedOAuthConfig = {
    authorizationEndpoint: string
    tokenEndpoint: string
    scopes: string[]
    clientIdEnv: string
    clientSecretEnv: string
    authorizeParams?: Record<string, string>
    accountEmail?: (accessToken: string) => Promise<string | undefined>
}

export type ManagedProvider = {
    id: string
    label: string
    oauth: ManagedOAuthConfig
    tools: ManagedTool[]
}

export function toolDefs(provider: ManagedProvider): ManagedToolDef[] {
    return provider.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

export function getTool(provider: ManagedProvider, name: string): ManagedTool | undefined {
    return provider.tools.find(t => t.name === name)
}
