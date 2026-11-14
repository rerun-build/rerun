import { z } from 'zod'
import { TEMPLATE_CATEGORIES, TEMPLATE_STATUSES, TEMPLATE_PRICING_MODELS, MIN_TEMPLATE_PRICE_CENTS, MAX_TEMPLATE_PRICE_CENTS, TEMPLATE_TITLE_MAX_LENGTH, TEMPLATE_STORY_MAX_STEPS, TEMPLATE_STORY_STATUSES, TEMPLATE_STORY_CAMERAS, TEMPLATE_STORY_ARTIFACT_TONES, TEMPLATE_STORY_MAX_ACTIONS } from './template-display.js'
import { triggerMethodSchema } from './trigger.js'

export * from './template-display.js'

const slugSchema = z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only')

const agentKeySchema = z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, numbers and underscores, starting with a letter')

export const templateImageSchema = z.object({
    url: z.string().min(1),
    alt: z.string().default(''),
})
export type TemplateImage = z.infer<typeof templateImageSchema>

export const templateConnectorSchema = z.object({
    slug: slugSchema,
    name: z.string(),
    icon: z.string().nullable(),
})
export type TemplateConnector = z.infer<typeof templateConnectorSchema>

export const templateSkillSchema = z.object({
    name: z.string().min(1),
    description: z.string().default(''),
})

export const templateScheduleSchema = z.object({
    name: z.string().min(1),
    cron: z.string().min(1),
})

export const templateTriggerSchema = z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    methods: z.array(triggerMethodSchema).default(['POST']),
})

export const templateFaqItemSchema = z.object({
    question: z.string().min(1),
    answer: z.string().default(''),
})
export type TemplateFaqItem = z.infer<typeof templateFaqItemSchema>

export const templateAgentSchema = z.object({
    key: agentKeySchema,
    name: z.string().min(1),
    role: z.string().default(''),
    description: z.string().default(''),
    connectorSlugs: z.array(z.string()).default([]),
    setupRequired: z.boolean().nullable().default(null),
    skills: z.array(templateSkillSchema).default([]),
    schedules: z.array(templateScheduleSchema).default([]),
    triggers: z.array(templateTriggerSchema).default([]),
    tools: z.array(z.string()).default([]),
})
export type TemplateAgent = z.infer<typeof templateAgentSchema>

export const templateStoryArtifactSchema = z.object({
    title: z.string().trim().min(1).max(40),
    line: z.string().trim().max(90).default(''),
    tone: z.enum(TEMPLATE_STORY_ARTIFACT_TONES).default('neutral'),
})
export type TemplateStoryArtifact = z.infer<typeof templateStoryArtifactSchema>

export const templateStoryStepSchema = z.object({
    id: z.string().min(1),
    caption: z.string().trim().min(1).max(80),
    detail: z.string().trim().max(160).default(''),
    agentKey: z.string().min(1),
    toolSlug: z.string().nullable().default(null),
    handoffTo: z.string().nullable().default(null),
    status: z.enum(TEMPLATE_STORY_STATUSES).default('working'),
    camera: z.enum(TEMPLATE_STORY_CAMERAS).default('agent'),
    artifact: templateStoryArtifactSchema.nullable().default(null),
    actions: z.array(z.string().trim().min(1).max(48)).max(TEMPLATE_STORY_MAX_ACTIONS).default([]),
})
export type TemplateStoryStep = z.infer<typeof templateStoryStepSchema>

export const templateStorySchema = z.array(templateStoryStepSchema).max(TEMPLATE_STORY_MAX_STEPS)

export const TEMPLATE_COST_ROUTES = ['subscription', 'credits', 'api_key'] as const
export type TemplateCostRoute = (typeof TEMPLATE_COST_ROUTES)[number]

export const templateProofSchema = z.object({
    task: z.string().trim().min(1),
    inputs: z.string().trim().default(''),
    output: z.string().trim().default(''),
    screenshots: z.array(templateImageSchema).max(4).default([]),
    videoUrl: z.string().trim().default(''),
    durationMinutes: z.number().positive().nullable().default(null),
    costUsd: z.number().min(0).nullable().default(null),
    model: z.string().trim().default(''),
    approvals: z.array(z.string().trim().min(1)).default([]),
    runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
})
export type TemplateProof = z.infer<typeof templateProofSchema>

export const templateWeeklyCostSchema = z.object({
    routes: z
        .array(z.object({ route: z.enum(TEMPLATE_COST_ROUTES), cost: z.string().trim().min(1), note: z.string().trim().default('') }))
        .min(1)
        .max(TEMPLATE_COST_ROUTES.length),
    assumptions: z.string().trim().default(''),
})
export type TemplateWeeklyCost = z.infer<typeof templateWeeklyCostSchema>

export const templateLinkSchema = z.object({
    label: z.string().trim().min(1),
    href: z.string().trim().min(1),
})
export type TemplateLink = z.infer<typeof templateLinkSchema>

export const templateWhoHiresSchema = z.object({
    title: z.string().trim().min(1),
    body: z.string().trim().default(''),
    href: z.string().trim().nullable().default(null),
})

export const templateRolePageSchema = z.object({
    proof: templateProofSchema.nullable().default(null),
    weeklyCost: templateWeeklyCostSchema.nullable().default(null),
    whoHires: z.array(templateWhoHiresSchema).max(3).default([]),
    compare: z.array(templateLinkSchema).max(4).default([]),
})
export type TemplateRolePage = z.infer<typeof templateRolePageSchema>

export const EMPTY_TEMPLATE_ROLE_PAGE: TemplateRolePage = { proof: null, weeklyCost: null, whoHires: [], compare: [] }

export const templateDocumentObject = z.object({
    slug: slugSchema,
    title: z.string().min(1).max(TEMPLATE_TITLE_MAX_LENGTH, `Title must be ${TEMPLATE_TITLE_MAX_LENGTH} characters or fewer`),
    tagline: z.string().default(''),
    longDescription: z.string().default(''),
    category: z.enum(TEMPLATE_CATEGORIES).default('other'),
    tags: z.array(z.string()).default([]),
    gallery: z.array(templateImageSchema).default([]),
    videoUrl: z.string().default(''),
    ogImageUrl: z.string().default(''),
    creatorId: z.string().uuid().nullable().default(null),
    metaTitle: z.string().default(''),
    metaDescription: z.string().default(''),
    setupMinutes: z.number().int().positive().default(5),
    pricingModel: z.enum(TEMPLATE_PRICING_MODELS).default('free'),
    priceAmountCents: z.number().int().min(0).max(MAX_TEMPLATE_PRICE_CENTS).default(0),
    featured: z.boolean().default(false),
    leadMagnet: z.boolean().default(false),
    status: z.enum(TEMPLATE_STATUSES).default('draft'),
    showInMarketplace: z.boolean().default(true),
    showInLibrary: z.boolean().default(true),

    agents: z.array(templateAgentSchema).default([]),
    faq: z.array(templateFaqItemSchema).default([]),
    story: templateStorySchema.default([]),
    rolePage: templateRolePageSchema.default(EMPTY_TEMPLATE_ROLE_PAGE),
})

export const templateDocumentSchema = templateDocumentObject.superRefine((doc, ctx) => {
    const keys = new Set<string>()

    for (const [i, agent] of doc.agents.entries()) {
        if (keys.has(agent.key)) ctx.addIssue({ code: 'custom', path: ['agents', i, 'key'], message: `Duplicate coworker key "${agent.key}"` })
        keys.add(agent.key)
    }

    if (doc.pricingModel === 'free' && doc.priceAmountCents !== 0) {
        ctx.addIssue({ code: 'custom', path: ['priceAmountCents'], message: 'A free template has no price' })
    }
    if (doc.pricingModel !== 'free' && doc.priceAmountCents < MIN_TEMPLATE_PRICE_CENTS) {
        ctx.addIssue({ code: 'custom', path: ['priceAmountCents'], message: `A paid template starts at $${MIN_TEMPLATE_PRICE_CENTS / 100}` })
    }
})
export type TemplateDocument = z.infer<typeof templateDocumentSchema>
