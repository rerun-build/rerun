import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { providerSchema, triggerMethodSchema } from '@moldwright/contracts'
import { deleteTrigger, listTriggers, readTrigger, rotateTriggerToken, triggerExists, writeTrigger } from '../../triggers/loader.js'
import { triggerPublicUrl, urlLine } from '../../triggers/url.js'
import type { RunContext } from '../../runtime/context.js'
import { PROVIDER_WITHOUT_MODEL, pinnedModel } from './automation-model.js'

export function triggerTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id
    return {
        trigger_list: tool({
            description: 'List your webhook triggers. Each one exposes a public URL that starts a run when an external service calls it. Instruction bodies are not included here; read one in full with trigger_get.',
            inputSchema: z.object({}),
            execute: async () => {
                const triggers = await listTriggers(id)
                if (triggers.length === 0) return 'No webhook triggers yet.'
                return triggers
                    .map(t => {
                        const state = t.enabled ? `${t.fireCount} call(s)${t.lastFiredAt ? `, last ${t.lastFiredAt}` : ''}` : 'disabled'
                        return `- ${t.name} (${t.slug}): ${t.methods.join('/')}, ${state}`
                    })
                    .join('\n')
            },
        }),
        trigger_create: tool({
            description:
                'Create a webhook trigger: a public URL that starts a run when an external service calls it. The body is the instruction you will execute, and the caller payload is attached to it. Give the returned URL to the user so they can paste it into the other service.',
            inputSchema: z.object({
                name: z.string(),
                description: z.string().describe('One line describing what this trigger reacts to'),
                body: z.string().describe('The instruction to run when the URL is called. The caller payload is appended to it.'),
                methods: z.array(triggerMethodSchema).optional().describe('HTTP methods the URL accepts. Defaults to POST only. Adding GET means any link preview can fire it.'),
                provider: providerSchema.optional().describe('Model provider to run this trigger under. Only with a model, and only for a provider plugged into this box.'),
                model: z.string().optional().describe('Model id to run this trigger under. Only if the user asks for one: left out, it follows your model.'),
            }),
            execute: async ({ name, description, body, methods, provider, model }) => {
                const pin = await pinnedModel(ctx, provider, model)
                if ('refusal' in pin) return pin.refusal
                const trigger = await writeTrigger(id, { name, description, body, methods, ...pin }, ctx.author)
                const url = await triggerPublicUrl(id, trigger)
                return `Created trigger ${trigger.slug} (${trigger.methods.join('/')}). ${urlLine(url)}`
            },
        }),
        trigger_get: tool({
            description:
                'Read one webhook trigger in full, including its instruction body and its public URL. Use this when the user asks where to call a trigger from, and always before changing a body so you edit what is actually there instead of rewriting it from memory.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!triggerExists(id, slug)) return `Trigger not found: ${slug}`
                const trigger = await readTrigger(id, slug)
                const url = await triggerPublicUrl(id, trigger)
                const lines = [
                    `${trigger.name} (${trigger.slug})`,
                    trigger.description ? `Description: ${trigger.description}` : '',
                    `Methods: ${trigger.methods.join('/')}`,
                    `Enabled: ${trigger.enabled}`,
                    `Calls: ${trigger.fireCount}${trigger.lastFiredAt ? ` (last ${trigger.lastFiredAt})` : ''}`,
                    urlLine(url),
                    '',
                    trigger.body,
                ]
                return lines.filter(Boolean).join('\n')
            },
        }),
        trigger_edit: tool({
            description:
                'Make a surgical edit to a webhook trigger body by replacing an exact string — this is the default way to change a body and it preserves everything else. Read the body with trigger_get first so oldString is an exact excerpt. Prefer this over trigger_update for any partial change. By default oldString must match exactly once.',
            inputSchema: z.object({
                slug: z.string(),
                oldString: z.string().describe('The exact text to replace'),
                newString: z.string().describe('The text to insert in its place'),
                replaceAll: z.boolean().default(false).describe('Replace every occurrence instead of requiring a unique match'),
            }),
            execute: async ({ slug, oldString, newString, replaceAll }) => {
                if (!triggerExists(id, slug)) return `Trigger not found: ${slug}`
                if (oldString === newString) return 'oldString and newString are identical; nothing to do.'
                const current = await readTrigger(id, slug)
                const occurrences = current.body.split(oldString).length - 1
                if (occurrences === 0)
                    return `oldString not found in ${slug}. Call trigger_get to read the current body, then retry with an exact excerpt of it. Never fall back to rewriting the whole body from memory.`
                if (occurrences > 1 && !replaceAll) return `oldString matches ${occurrences} times in ${slug}; pass replaceAll or provide a more specific string.`
                const body = replaceAll ? current.body.split(oldString).join(newString) : current.body.replace(oldString, newString)
                await writeTrigger(id, {
                    name: current.name,
                    description: current.description,
                    body,
                    methods: current.methods,
                    enabled: current.enabled,
                    provider: current.provider,
                    model: current.model,
                })
                return `Edited trigger ${slug} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`
            },
        }),
        trigger_update: tool({
            description:
                'Update a webhook trigger: its description, instruction body, accepted HTTP methods, model, or enable/disable it. The name and URL cannot change. Passing body overwrites the entire instruction body, discarding all of its existing content: use it ONLY for a deliberate full rewrite of a body you have just read with trigger_get, never for one you reconstructed from memory. For ANY partial change to the body, use trigger_edit instead.',
            inputSchema: z.object({
                slug: z.string(),
                description: z.string().optional(),
                body: z.string().optional(),
                methods: z.array(triggerMethodSchema).optional(),
                enabled: z.boolean().optional(),
                provider: providerSchema.optional().describe('Model provider to run this trigger under. Only with a model, and only for a provider plugged into this box.'),
                model: z.string().optional().describe('Model id to run this trigger under. Only if the user asks for one.'),
            }),
            execute: async ({ slug, description, body, methods, enabled, provider, model }) => {
                if (!triggerExists(id, slug)) return `Trigger not found: ${slug}`
                if (provider && !model) return PROVIDER_WITHOUT_MODEL
                const pin = model ? await pinnedModel(ctx, provider, model) : {}
                if ('refusal' in pin) return pin.refusal
                const current = await readTrigger(id, slug)
                await writeTrigger(id, {
                    name: current.name,
                    description: description ?? current.description,
                    body: body ?? current.body,
                    methods: methods ?? current.methods,
                    enabled: enabled ?? current.enabled,
                    ...pin,
                })
                if (body !== undefined && body !== current.body) return `Updated trigger ${slug} (body replaced: ${current.body.length} → ${body.length} chars)`
                return `Updated trigger ${slug}`
            },
        }),
        trigger_rotate_token: tool({
            description: 'Rotate a webhook trigger secret, which changes its public URL. Every service already calling the old URL stops working, so confirm with the user first.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!triggerExists(id, slug)) return `Trigger not found: ${slug}`
                const trigger = await rotateTriggerToken(id, slug)
                const url = await triggerPublicUrl(id, trigger)
                return `Rotated the secret of ${slug}. ${urlLine(url)}`
            },
        }),
        trigger_delete: tool({
            description: 'Delete a webhook trigger. Its URL stops working immediately.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!triggerExists(id, slug)) return `Trigger not found: ${slug}`
                await deleteTrigger(id, slug)
                return `Deleted trigger ${slug}`
            },
        }),
    }
}
