import { agentConfigSchema, agentDetailSchema, agentModelsSchema, agentViewSchema, aiConnectionsViewSchema, providerSchema } from '@rerun/contracts'
import { z } from 'zod'

// What a shipped build reads, with the provider list it was compiled with, parsed strictly: one
// provider it does not know anywhere fails the whole answer.
function shippedSchemas<Providers extends z.ZodType<string>>(provider: Providers) {
    return {
        connectionsView: aiConnectionsViewSchema.extend({
            connections: z.array(aiConnectionsViewSchema.shape.connections.element.extend({ provider })),
            addable: z.array(aiConnectionsViewSchema.shape.addable.element.extend({ provider })),
        }),
        agentModels: agentModelsSchema.extend({ groups: z.array(agentModelsSchema.shape.groups.element.extend({ provider })) }),
        agentView: agentViewSchema.extend({
            detail: agentDetailSchema.extend({ config: agentConfigSchema.extend({ provider: provider.nullable().default(null) }), resolvedProvider: provider.nullable().default(null) }).nullable(),
        }),
    }
}

// The iOS builds from before OpenCode and custom endpoints.
export const shippedIosProviderSchema = z.enum(['rerun', 'anthropic', 'claude', 'codex', 'openai', 'google', 'openrouter'])

const shippedIos = shippedSchemas(shippedIosProviderSchema)
export const shippedIosConnectionsViewSchema = shippedIos.connectionsView
export const shippedIosAgentModelsSchema = shippedIos.agentModels
export const shippedIosAgentViewSchema = shippedIos.agentView

// Every build, iOS and Android, from before Grok.
export const shippedBeforeGrok = shippedSchemas(providerSchema.exclude(['grok']))
