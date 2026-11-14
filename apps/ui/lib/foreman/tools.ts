import 'server-only'

import { jsonSchema, tool, type ToolSet } from 'ai'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { requireString } from '@/lib/mcp/args'
import { dispatchOnboardingTool } from './onboarding-tools'
import { phaseSpec, phaseTools, pinnedPlanBoxes, planKinds } from './phases'
import { isMobileApp, type ForemanState } from './phase'
import { searchForemanDocs } from './search-docs'
import type { ForemanTurn } from './turn'
import { FOREMAN_CLIENT_TOOL_DEFS, FOREMAN_DOCS_TOOL_DEFS, FOREMAN_ONBOARDING_TOOL_DEFS, FOREMAN_TOOL_NAMES, FOREMAN_WIDGET_TOOL_DEFS, showPlanDef, showTemplatesDef, type ForemanToolDef } from './tool-defs'

type ForemanContext = {
    ctx: WorkspaceContext
    turn: ForemanTurn
}

export function foremanActiveTools(state: ForemanState): string[] {
    const tools = phaseTools(phaseSpec(state.phase), state) as readonly string[]
    return tools.filter(name => !(state.entitled && name === 'open_checkout') && !(isMobileApp(state) && name === 'contact_team'))
}

export function foremanTools({ ctx, turn }: ForemanContext): ToolSet {
    const belt: ToolSet = {}
    const onBelt = (def: ForemanToolDef) => (FOREMAN_TOOL_NAMES as readonly string[]).includes(def.name)

    const kinds = planKinds(turn.state())
    const pinned = pinnedPlanBoxes(turn.state())
    const forKinds = (def: ForemanToolDef): ForemanToolDef => {
        if (def.name === 'show_plan') return showPlanDef(kinds, pinned)
        if (def.name === 'show_templates') return showTemplatesDef(pinned)
        return def
    }

    const declare = (def: ForemanToolDef, execute?: (args: Record<string, unknown>) => Promise<unknown>) => {
        const base = { description: def.description, inputSchema: jsonSchema<Record<string, unknown>>(def.inputSchema) }
        const run = execute
            ? async (args: Record<string, unknown>) => {
                  const result = await execute(args ?? {})
                  turn.note(def.name, result)
                  return result
              }
            : undefined
        belt[def.name] = run ? tool({ ...base, execute: run }) : tool(base)
    }

    for (const def of FOREMAN_DOCS_TOOL_DEFS) declare(def, args => searchForemanDocs(requireString(args.query, 'query')))
    for (const def of FOREMAN_ONBOARDING_TOOL_DEFS.filter(onBelt)) declare(def, args => dispatchOnboardingTool(ctx, def.name, args))
    for (const def of FOREMAN_CLIENT_TOOL_DEFS.filter(onBelt)) declare(def)
    for (const def of FOREMAN_WIDGET_TOOL_DEFS) declare(forKinds(def))

    return belt
}
