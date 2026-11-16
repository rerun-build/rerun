export type SizedTool = { name: string; tokens: number }

export function groupTools<T extends { name: string }>(tools: T[]): { group: string; tools: T[] }[] {
    const byGroup = new Map<string, T[]>()
    for (const tool of tools) {
        const index = tool.name.indexOf('_')
        const group = index > 0 ? tool.name.slice(0, index) : ''
        const list = byGroup.get(group)
        if (list) list.push(tool)
        else byGroup.set(group, [tool])
    }
    const groups: { group: string; tools: T[] }[] = []
    const other: T[] = []
    for (const [group, list] of byGroup) {
        if (group === '' || list.length === 1) other.push(...list)
        else groups.push({ group, tools: list })
    }
    const order = new Map(tools.map((tool, i) => [tool, i]))
    other.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    if (other.length > 0) groups.push({ group: 'other', tools: other })
    return groups
}

export function pickedTokens(tools: SizedTool[], picks: string[]): number {
    const chosen = picks.length === 0 ? tools : tools.filter(tool => picks.includes(tool.name))
    return chosen.reduce((sum, tool) => sum + tool.tokens, 0)
}

export function startingContextTokens(input: {
    promptTokens: number
    families: { enabled?: boolean; tokens?: number }[]
    servers: { tools: SizedTool[]; picks: string[] }[]
}): number {
    const families = input.families.reduce((sum, family) => sum + (family.enabled === true ? (family.tokens ?? 0) : 0), 0)
    const servers = input.servers.reduce((sum, server) => sum + pickedTokens(server.tools, server.picks), 0)
    return input.promptTokens + families + servers
}

export const ROLE_TOOL_SETS = {
    lookup: ['search_symbols', 'get_symbol', 'find_references', 'get_file_content'],
    reviewer: ['search_symbols', 'get_symbol', 'find_references', 'get_file_context', 'what_changed', 'diff_symbols', 'analyze_file_impact'],
    builder: ['search_symbols', 'get_symbol', 'find_references', 'get_file_content', 'replace_symbol_body', 'edit_within_symbol', 'validate_file_syntax'],
    runner: ['run_and_watch', 'command_status', 'bucket_wait', 'command_output_tail', 'command_stop'],
} as const

export type ToolRole = keyof typeof ROLE_TOOL_SETS

export function roleSetPicks(role: ToolRole, tools: { name: string }[]): string[] {
    const set: readonly string[] = ROLE_TOOL_SETS[role]
    return tools.map(tool => tool.name).filter(name => set.includes(name))
}
