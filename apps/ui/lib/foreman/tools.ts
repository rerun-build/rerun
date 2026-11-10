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

// The onboarding foreman's tool belt. A wiring file: every geste already exists as something the
// app itself calls. What it is allowed to do is declared next door, in tool-defs.ts.

// What the phase does not list is not handed over at all. Telling the model not to write a plan
// before the interview only works until it decides otherwise; a step without show_plan works always.
//
// Read per step rather than per request, because the phase moves inside a turn: save_profile opens
// the plan, and the model has to be handed the belt of where it now stands, not of where the request
// started.
export function foremanActiveTools(state: ForemanState): string[] {
    const tools = phaseTools(phaseSpec(state.phase), state) as readonly string[]
    // Asking for a card from a workspace that already has a plan throws ALREADY_SUBSCRIBED, and the
    // user reads a failed tool call. The app has no team chat to hand a contact_team over to.
    return tools.filter(name => !(state.entitled && name === 'open_checkout') && !(isMobileApp(state) && name === 'contact_team'))
}

export function foremanTools({ ctx, turn }: ForemanContext): ToolSet {
    const belt: ToolSet = {}
    const onBelt = (def: ForemanToolDef) => (FOREMAN_TOOL_NAMES as readonly string[]).includes(def.name)

    // What a plan is allowed to hold, read once: the phase moves inside a turn but the link the user
    // arrived with does not, and a schema cannot be swapped between two steps the way activeTools is.
    const kinds = planKinds(turn.state())
    const pinned = pinnedPlanBoxes(turn.state())
    const forKinds = (def: ForemanToolDef): ForemanToolDef => {
        if (def.name === 'show_plan') return showPlanDef(kinds, pinned)
        if (def.name === 'show_templates') return showTemplatesDef(pinned)
        return def
    }

    const declare = (def: ForemanToolDef, execute?: (args: Record<string, unknown>) => Promise<unknown>) => {
        const base = { description: def.description, inputSchema: jsonSchema<Record<string, unknown>>(def.inputSchema) }
        // Everything is declared and the step decides what is reachable, through activeTools. A tool
        // that threw is not reported to the turn: nothing it would have changed happened.
        const run = execute
            ? async (args: Record<string, unknown>) => {
                  const result = await execute(args ?? {})
                  turn.note(def.name, result)
                  return result
              }
            : undefined
        // Two shapes rather than a spread: `tool()` picks its overload from whether `execute` is
        // there, and a conditional spread hands it a union it resolves to the wrong one.
        belt[def.name] = run ? tool({ ...base, execute: run }) : tool(base)
    }

    for (const def of FOREMAN_DOCS_TOOL_DEFS) declare(def, args => searchForemanDocs(requireString(args.query, 'query')))
    for (const def of FOREMAN_ONBOARDING_TOOL_DEFS.filter(onBelt)) declare(def, args => dispatchOnboardingTool(ctx, def.name, args))
    // No execute: the browser resolves these and answers with addToolResult. The client tools
    // answer by themselves, the widgets wait for the user.
    for (const def of FOREMAN_CLIENT_TOOL_DEFS.filter(onBelt)) declare(def)
    for (const def of FOREMAN_WIDGET_TOOL_DEFS) declare(forKinds(def))

    return belt
}
