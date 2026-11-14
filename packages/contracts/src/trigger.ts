import { z } from 'zod'
import { providerSchema } from './agent.js'

export const triggerMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
export type TriggerMethod = z.infer<typeof triggerMethodSchema>

export const triggerSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
    token: z.string(),
    methods: z.array(triggerMethodSchema).default(['POST']),
    lastFiredAt: z.string().nullable(),
    fireCount: z.number().int().nonnegative().default(0),
    connectionId: z.string().nullable(),
    provider: providerSchema.nullable(),
    model: z.string().nullable(),
    body: z.string().default(''),
    createdAt: z.string(),
})
export type Trigger = z.infer<typeof triggerSchema>

export const triggersListSchema = z.object({ triggers: z.array(triggerSchema) })

export const createTriggerSchema = z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    body: z.string().min(1),
    methods: z.array(triggerMethodSchema).min(1).optional(),
    enabled: z.boolean().optional(),
    connectionId: z.string().nullable().optional(),
    provider: providerSchema.nullable().default(null),
    model: z.string().nullable().default(null),
})

export const updateTriggerSchema = z.object({
    description: z.string().optional(),
    body: z.string().optional(),
    methods: z.array(triggerMethodSchema).min(1).optional(),
    enabled: z.boolean().optional(),
    connectionId: z.string().nullable().optional(),
    provider: providerSchema.nullable().optional(),
    model: z.string().nullable().optional(),
})

export const triggerFireSchema = z.object({
    token: z.string().min(1),
    method: triggerMethodSchema,
    query: z.string().default(''),
    contentType: z.string().default(''),
    body: z.string().default(''),
    bodyBytes: z.number().int().nonnegative().default(0),
})
export type TriggerFireInput = z.infer<typeof triggerFireSchema>
