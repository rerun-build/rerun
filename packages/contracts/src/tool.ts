import { z } from 'zod'

export const toolDescriptorSchema = z.object({
    name: z.string(),
    description: z.string().default(''),
    tokens: z.number().int().nonnegative().optional(),
})
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>

export const toolFamilySchema = z.object({
    family: z.string(),
    description: z.string().default(''),
    enabled: z.boolean().optional(),
    tokens: z.number().int().nonnegative().optional(),
    tools: z.array(toolDescriptorSchema).default([]),
})
export type ToolFamily = z.infer<typeof toolFamilySchema>

export const toolsListSchema = z.object({ families: z.array(toolFamilySchema), promptTokens: z.number().int().nonnegative().optional() })
