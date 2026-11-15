import { z } from 'zod'

export const OPENCODE_PLANS = ['go', 'console'] as const
export type OpencodePlan = (typeof OPENCODE_PLANS)[number]

export type OpencodeWire = 'anthropic' | 'responses' | 'chat' | 'google'

export type OpencodeModel = {
    id: string
    upstreamId: string
    plan: OpencodePlan
    label: string
    wire: OpencodeWire
    baseUrl: string
    contextWindow: number
    outputLimit: number
    images: boolean
    reasoning: boolean
    price: { input: number; output: number; cacheRead: number | null }
}

export const OPENCODE_CATALOG_URL: Record<OpencodePlan, string> = {
    go: 'https://opencode.ai/inference/go/v1/models',
    console: 'https://opencode.ai/inference/v1/models',
}

export const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

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

export function opencodeUpstreamId(id: string): string {
    const plan = opencodePlanOf(id)
    return plan ? id.slice(plan.length + 1) : id
}

export function isFreeOpencodeModel(price: Pick<OpencodeModel['price'], 'input' | 'output'>): boolean {
    return price.input === 0 && price.output === 0
}

function entryToModel(entry: z.infer<typeof catalogEntrySchema>, plan: OpencodePlan): OpencodeModel | null {
    if (entry.type !== 'chat' || !entry.capabilities.tools.supported) return null
    const { input, output } = entry.cost.text
    if (plan === 'console' && isFreeOpencodeModel({ input: input.price, output: output.price })) return null
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

export const OPENCODE_DEFAULT_MODEL = 'go/deepseek-v4-pro'

const usageWindowSchema = z.object({ status: z.string(), percent: z.number(), resetsAt: z.string().nullable().optional() })
export const opencodeUsageSchema = z.object({
    usage: z.object({ rolling: usageWindowSchema.optional(), weekly: usageWindowSchema.optional(), monthly: usageWindowSchema.optional() }),
})
export type OpencodeUsage = z.infer<typeof opencodeUsageSchema>
