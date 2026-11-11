import { z } from 'zod'

import { conversationMessageSchema } from './conversation.js'
import { TEMPLATE_CATEGORIES } from './template-display.js'

// The foreman lives on every engine under this fixed id, outside the agent index: the board, the
// `call_agent` roster and `GET /agents` never see it.
export const FOREMAN_AGENT_ID = 'foreman'

// What the user calls it. `foreman` stays the id, the kind and the route everywhere.
export const FOREMAN_DISPLAY_NAME = 'Chief of Staff'

// Carries the brief's `hubToken` on the foreman's calls to the hub, which signed it: the engine key
// alone does not prove the caller is the foreman.
export const FOREMAN_HUB_TOKEN_HEADER = 'x-rerun-foreman-token'

// A board gesture the foreman asks the browser to make (open a panel, focus an agent). Sent as a
// transient data part so it fires once, live, and never replays when the conversation reloads.
export const FOREMAN_INTENT_PART = 'data-foreman-intent'
export type ForemanIntent = { tool: string; input: unknown }

// `hub` tools run on the hub through POST /api/hub, `intent` tools only emit a board gesture.
// `serial` hub tools never overlap within one engine: two `create_agent` in the same step would
// otherwise race for the same handle and the same cell.
export const foremanToolSpecSchema = z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    kind: z.enum(['hub', 'intent']),
    serial: z.boolean().default(false),
})
export type ForemanToolSpec = z.infer<typeof foremanToolSpecSchema>

// What the hub hands the foreman on every turn: its instructions and its tools. Both live in the
// hub so that changing either is a hub deploy, never a fleet update.
export const foremanBriefSchema = z.object({
    instructions: z.string().min(1),
    tools: z.array(foremanToolSpecSchema).max(64).default([]),
    hubToken: z.string().min(1).optional(),
})
export type ForemanBrief = z.infer<typeof foremanBriefSchema>

// Which foreman the workspace talks to: the onboarding's on the hub, the everyday one on the engine, or
// none at all for a workspace past its onboarding with no machine.
export const foremanSurfaceSchema = z.enum(['onboarding', 'engine', 'none'])
export type ForemanSurface = z.infer<typeof foremanSurfaceSchema>

export const FOREMAN_PHASES = ['waitlist', 'discover', 'plan', 'trial', 'build', 'companion'] as const
export const foremanPhaseSchema = z.enum(FOREMAN_PHASES)
export type ForemanPhase = z.infer<typeof foremanPhaseSchema>

// Where the onboarding is walked. The app sells nothing, so the hub keeps every price, card and
// payment out of what it says there, and its trial starts without a card.
export const foremanClientSchema = z.enum(['web', 'ios'])
export type ForemanClient = z.infer<typeof foremanClientSchema>

// GET /api/chat/foreman/state.
export const foremanStateSchema = z.looseObject({ surface: foremanSurfaceSchema, phase: foremanPhaseSchema, firstName: z.string() })
export type ForemanStateResponse = z.infer<typeof foremanStateSchema>

// GET /api/chat/foreman/engine: the caller's last conversation with the engine's foreman, null before
// the first one. With `?sessionId=`, the transcript of that conversation alone.
export const foremanEngineConversationSchema = z
    .looseObject({ sessionId: z.string(), title: z.string().nullable().optional(), messages: z.array(conversationMessageSchema), activeRunId: z.string().nullable().optional() })
    .nullable()
export const foremanEngineMessagesSchema = z.object({ messages: z.array(conversationMessageSchema) })

const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES)

// POST /api/v1/foreman/intake: the welcome card's answers, the same four the web card hands over.
// `decidedIndustry` is what POST /api/v1/foreman/industry made of the site while they kept answering.
export const foremanIntakeSchema = z.object({
    companyUrl: z.string().trim().max(500).nullable(),
    industry: templateCategorySchema.nullable(),
    decidedIndustry: templateCategorySchema.nullable(),
    industryLabel: z.string().trim().max(200).nullable(),
    position: z.string().trim().max(200).nullable(),
    firstName: z.string().trim().max(100).nullable(),
})
export type ForemanIntakeRequest = z.infer<typeof foremanIntakeSchema>
export const foremanIndustryRequestSchema = z.object({ input: z.string().trim().min(1).max(500) })
// The industry the profile was written with, or the fast guess for a site: null when nothing could be told.
export const foremanIndustryResultSchema = z.object({ industry: templateCategorySchema.nullable() })

// POST /api/v1/foreman/trial: false when the workspace cannot start one from the app (a trial already spent).
export const foremanTrialResultSchema = z.object({ entitled: z.boolean() })
export type ForemanTrialResult = z.infer<typeof foremanTrialResultSchema>

// GET /api/v1/foreman/files: whether the engine's foreman takes files in its own workspace. A box
// that predates it refuses every upload, so the app offers no attachment there.
export const foremanEngineFilesSchema = z.object({ supported: z.boolean() })
export type ForemanEngineFiles = z.infer<typeof foremanEngineFilesSchema>

// POST /api/v1/foreman/lead: the install of the coworker the build put first, or the conversation of
// the one already started.
export const foremanLeadRequestSchema = z.object({ agentId: z.string().min(1) })
export const foremanLeadResultSchema = z.object({ conversationId: z.string(), runId: z.string().nullable() })
