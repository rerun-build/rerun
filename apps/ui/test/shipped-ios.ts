import { agentConfigSchema, agentDetailSchema, agentModelsSchema, agentViewSchema, aiConnectionsViewSchema } from '@rerun/contracts'
import { z } from 'zod'

// The provider list as the iOS builds from before OpenCode and custom endpoints parse it, strictly:
// one provider they do not know anywhere fails the whole answer.
export const shippedIosProviderSchema = z.enum(['rerun', 'anthropic', 'claude', 'codex', 'openai', 'google', 'openrouter'])

export const shippedIosConnectionsViewSchema = aiConnectionsViewSchema.extend({
    connections: z.array(aiConnectionsViewSchema.shape.connections.element.extend({ provider: shippedIosProviderSchema })),
    addable: z.array(aiConnectionsViewSchema.shape.addable.element.extend({ provider: shippedIosProviderSchema.exclude(['rerun']) })),
})

export const shippedIosAgentModelsSchema = agentModelsSchema.extend({ groups: z.array(agentModelsSchema.shape.groups.element.extend({ provider: shippedIosProviderSchema })) })

export const shippedIosAgentViewSchema = agentViewSchema.extend({
    detail: agentDetailSchema
        .extend({ config: agentConfigSchema.extend({ provider: shippedIosProviderSchema.nullable().default(null) }), resolvedProvider: shippedIosProviderSchema.nullable().default(null) })
        .nullable(),
})
