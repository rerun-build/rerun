import { z } from 'zod'

// OpenCode sells one API key that reaches two catalogs: Go, a subscription whose models are paid by
// the plan, and Console, paid per token from the account's credits. A model listed on both sides is
// two distinct picks, so the plan is part of the Rerun id: `go/<id>` and `console/<id>`.
export const OPENCODE_PLANS = ['go', 'console'] as const
export type OpencodePlan = (typeof OPENCODE_PLANS)[number]

// The wire format each model is served on, one per model: OpenCode proxies every vendor on its own
// API (`messages`, `responses`, `chat-completions`, `generate-content`).
export type OpencodeWire = 'anthropic' | 'responses' | 'chat' | 'google'

export type OpencodeModel = {
    id: string
    // The id OpenCode knows the model by: the only one that leaves the box.
    upstreamId: string
    plan: OpencodePlan
    label: string
    wire: OpencodeWire
    baseUrl: string
    contextWindow: number
    outputLimit: number
    images: boolean
    reasoning: boolean
    // USD per million tokens.
    price: { input: number; output: number; cacheRead: number | null }
}

// Both catalogs are public: they answer without a key.
export const OPENCODE_CATALOG_URL: Record<OpencodePlan, string> = {
    go: 'https://opencode.ai/inference/go/v1/models',
    console: 'https://opencode.ai/inference/v1/models',
}

// The only endpoint that checks a key, and the one that reports the Go plan's windows.
export const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

// Every request is refused (400 `MissingSessionID`) without it.
export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

// The key goes to whatever base URL the catalog names, so a catalog entry pointing anywhere else is
// dropped rather than trusted.
const OPENCODE_ORIGIN = 'https://opencode.ai/'

const WIRE_OF_STYLE: Record<string, OpencodeWire> = {
    messages: 'anthropic',
    responses: 'responses',
    'chat-completions': 'chat',
    'generate-content': 'google',
}

const catalogEntrySchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string(),
    modalities: z.object({ input: z.array(z.string()).default([]) }).optional(),
    capabilities: z.object({
        tools: z.object({ supported: z.boolean() }),
        reasoning: z.object({ supported: z.boolean() }).optional(),
    }),
    limit: z.object({ context: z.number().positive(), input: z.number().positive().optional(), output: z.number().positive() }),
    cost: z.object({
        text: z.object({
            input: z.object({ price: z.number().nonnegative(), cache: z.object({ read: z.number().nonnegative().optional() }).optional() }),
            output: z.object({ price: z.number().nonnegative() }),
        }),
    }),
    api: z.record(z.string(), z.object({ base_url: z.string() })),
})

export function opencodeModelId(plan: OpencodePlan, upstreamId: string): string {
    return `${plan}/${upstreamId}`
}

export function isOpencodeModelId(id: string): boolean {
    return OPENCODE_PLANS.some(plan => id.startsWith(`${plan}/`))
}

export function opencodePlanOf(id: string): OpencodePlan | null {
    return OPENCODE_PLANS.find(plan => id.startsWith(`${plan}/`)) ?? null
}

// The id without its plan, for a caller that has nothing but the Rerun id (a GPT has to be told
// apart from a Claude whichever plan serves it).
export function opencodeUpstreamId(id: string): string {
    const plan = opencodePlanOf(id)
    return plan ? id.slice(plan.length + 1) : id
}

function entryToModel(entry: z.infer<typeof catalogEntrySchema>, plan: OpencodePlan): OpencodeModel | null {
    if (entry.type !== 'chat' || !entry.capabilities.tools.supported) return null
    const { input, output } = entry.cost.text
    // Free models (`*-free`, `big-pickle`) are reserved to OpenCode's own client.
    if (input.price === 0 && output.price === 0) return null
    const styles = Object.entries(entry.api).filter(([style]) => WIRE_OF_STYLE[style])
    if (styles.length !== 1) return null
    const [style, { base_url: baseUrl }] = styles[0]!
    if (!baseUrl.startsWith(OPENCODE_ORIGIN)) return null
    return {
        id: opencodeModelId(plan, entry.id),
        upstreamId: entry.id,
        plan,
        label: entry.name,
        wire: WIRE_OF_STYLE[style]!,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        contextWindow: entry.limit.input ?? entry.limit.context,
        outputLimit: entry.limit.output,
        images: (entry.modalities?.input ?? []).some(kind => kind === 'image' || kind.startsWith('image/')),
        reasoning: entry.capabilities.reasoning?.supported ?? false,
        price: { input: input.price, output: output.price, cacheRead: input.cache?.read ?? null },
    }
}

// One invalid entry is skipped, never the whole catalog: OpenCode publishes models faster than this
// parser learns their quirks. Sorted by id so a regenerated snapshot only moves where the catalog did.
export function parseOpencodeCatalog(json: unknown, plan: OpencodePlan): OpencodeModel[] {
    const data = (json as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) return []
    const models: OpencodeModel[] = []
    const seen = new Set<string>()
    for (const raw of data) {
        const parsed = catalogEntrySchema.safeParse(raw)
        if (!parsed.success) continue
        const model = entryToModel(parsed.data, plan)
        if (!model || seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
    }
    return models.sort((a, b) => a.id.localeCompare(b.id))
}

// What a box tells the hub about the models its OpenCode connection reaches, read from the live
// catalog: the hub has only the snapshot it was built with.
export const providerModelSchema = z.object({
    id: z.string(),
    label: z.string(),
    plan: z.enum(OPENCODE_PLANS),
    contextWindow: z.number(),
    images: z.boolean(),
    price: z.object({ input: z.number(), output: z.number(), cacheRead: z.number().nullable() }),
})
export type ProviderModel = z.infer<typeof providerModelSchema>

export function toProviderModel({ id, label, plan, contextWindow, images, price }: OpencodeModel): ProviderModel {
    return { id, label, plan, contextWindow, images, price }
}

// The pick a fresh OpenCode connection runs: an open model the Go plan includes, good with tools.
export const OPENCODE_DEFAULT_MODEL = 'go/deepseek-v4-pro'

// What a Go subscription reports at `/usage`, for the whole account.
const usageWindowSchema = z.object({ status: z.string(), percent: z.number(), resetsAt: z.string().nullable().optional() })
export const opencodeUsageSchema = z.object({
    usage: z.object({ rolling: usageWindowSchema.optional(), weekly: usageWindowSchema.optional(), monthly: usageWindowSchema.optional() }),
})
export type OpencodeUsage = z.infer<typeof opencodeUsageSchema>
