import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { providerSchema } from '@rerun/contracts'
import { deleteSchedule, listSchedules, readSchedule, scheduleExists, updateScheduleAt, writeSchedule } from '../../schedules/loader.js'
import { isValidCron, isValidTimezone, nextRunAt } from '../../schedules/cron.js'
import type { RunContext } from '../../runtime/context.js'
import { PROVIDER_WITHOUT_MODEL, pinnedModel } from './automation-model.js'

export function scheduleTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id
    return {
        schedule_list: tool({
            description: 'List your scheduled tasks (recurring cron jobs and one-shot reminders). Instruction bodies are not included here; read one in full with schedule_get.',
            inputSchema: z.object({}),
            execute: async () => {
                const schedules = await listSchedules(id)
                if (schedules.length === 0) return 'No scheduled tasks yet.'
                const now = new Date()
                return schedules
                    .map(s => {
                        const trigger = s.cron ? `cron ${s.cron}` : `once ${s.runAt}`
                        const state = s.enabled ? `next ${nextRunAt(s, now) ?? 'never'}` : 'disabled'
                        return `- ${s.name} (${s.slug}): ${trigger}, ${state}`
                    })
                    .join('\n')
            },
        }),
        schedule_get: tool({
            description: 'Read one scheduled task in full, including the instruction body it runs when it fires. Always call this before changing a body, so you edit what is actually there instead of rewriting it from memory.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!scheduleExists(id, slug)) return `Schedule not found: ${slug}`
                const schedule = await readSchedule(id, slug)
                const lines = [
                    `${schedule.name} (${schedule.slug})`,
                    schedule.description ? `Description: ${schedule.description}` : '',
                    schedule.cron ? `Cron: ${schedule.cron}` : `Runs once at: ${schedule.runAt}`,
                    schedule.timezone ? `Timezone: ${schedule.timezone}` : '',
                    `Enabled: ${schedule.enabled}`,
                    schedule.enabled ? `Next run: ${nextRunAt(schedule, new Date()) ?? 'never'}` : '',
                    schedule.lastRunAt ? `Last run: ${schedule.lastRunAt}` : '',
                    schedule.model ? `Model: ${schedule.model}${schedule.provider ? ` (${schedule.provider})` : ''}` : '',
                    '',
                    schedule.body,
                ]
                return lines.filter(Boolean).join('\n')
            },
        }),
        schedule_create: tool({
            description:
                'Schedule a task to run later without a user message. Provide a cron expression for a recurring task OR runAt (ISO 8601) for a one-shot. The body is the instruction you will execute when it fires.',
            inputSchema: z.object({
                name: z.string(),
                description: z.string().describe('One line describing the routine'),
                body: z.string().describe('The instruction to run when the task fires'),
                cron: z.string().optional().describe("Cron expression, e.g. '0 8 * * *'"),
                runAt: z.string().optional().describe('ISO 8601 timestamp for a one-shot task'),
                timezone: z.string().optional().describe("IANA timezone, e.g. 'Europe/Paris'"),
                provider: providerSchema.optional().describe('Model provider to run this task under. Only with a model, and only for a provider plugged into this box.'),
                model: z.string().optional().describe("Model id to run this task under, e.g. 'claude-opus-4-8'. Only if the user asks for one: left out, the task follows your model."),
            }),
            execute: async ({ name, description, body, cron, runAt, timezone, provider, model }) => {
                if (!cron && !runAt) return 'Provide either cron (recurring) or runAt (one-shot).'
                if (cron && runAt) return 'Provide only one of cron or runAt, not both.'
                if (cron && !isValidCron(cron)) return `Invalid cron expression: ${cron}`
                if (runAt && Number.isNaN(new Date(runAt).getTime())) return `Invalid runAt timestamp: ${runAt}`
                if (timezone && !isValidTimezone(timezone)) return `Invalid timezone: ${timezone}. Use an IANA name, e.g. 'Europe/Paris' or 'America/New_York'.`
                const pin = await pinnedModel(ctx, provider, model)
                if ('refusal' in pin) return pin.refusal
                const schedule = await writeSchedule(id, { name, description, body, cron, runAt, timezone, ...pin }, ctx.author)
                return `Created schedule ${schedule.slug}`
            },
        }),
        schedule_update: tool({
            description:
                'Update an existing scheduled task (description, cron, runAt, timezone, provider, model, or enable/disable it). Passing body overwrites the entire instruction body, discarding all of its existing content: use it ONLY for a deliberate full rewrite of a body you have just read with schedule_get, never for one you reconstructed from memory. For ANY partial change to the body, use schedule_edit instead.',
            inputSchema: z.object({
                slug: z.string(),
                description: z.string().optional(),
                body: z.string().optional(),
                cron: z.string().optional(),
                runAt: z.string().optional(),
                timezone: z.string().optional(),
                enabled: z.boolean().optional(),
                provider: providerSchema.optional().describe('Model provider to run this task under. Only with a model, and only for a provider plugged into this box.'),
                model: z.string().optional().describe("Model id to run this task under, e.g. 'claude-opus-4-8'. Only if the user asks for one."),
            }),
            execute: async ({ slug, description, body, cron, runAt, timezone, enabled, provider, model }) => {
                if (!scheduleExists(id, slug)) return `Schedule not found: ${slug}`
                if (cron && !isValidCron(cron)) return `Invalid cron expression: ${cron}`
                if (runAt && Number.isNaN(new Date(runAt).getTime())) return `Invalid runAt timestamp: ${runAt}`
                if (timezone && !isValidTimezone(timezone)) return `Invalid timezone: ${timezone}. Use an IANA name, e.g. 'Europe/Paris' or 'America/New_York'.`
                if (provider && !model) return PROVIDER_WITHOUT_MODEL
                const pin = model ? await pinnedModel(ctx, provider, model) : {}
                if ('refusal' in pin) return pin.refusal
                const current = await readSchedule(id, slug)
                await updateScheduleAt(id, slug, { description, body, cron, runAt, timezone, enabled, ...pin })
                if (body !== undefined && body !== current.body) return `Updated schedule ${slug} (body replaced: ${current.body.length} → ${body.length} chars)`
                return `Updated schedule ${slug}`
            },
        }),
        schedule_edit: tool({
            description:
                'Make a surgical edit to a scheduled task body by replacing an exact string — this is the default way to change a body and it preserves everything else. Read the body with schedule_get first so oldString is an exact excerpt. Prefer this over schedule_update for any partial change. By default oldString must match exactly once.',
            inputSchema: z.object({
                slug: z.string(),
                oldString: z.string().describe('The exact text to replace'),
                newString: z.string().describe('The text to insert in its place'),
                replaceAll: z.boolean().default(false).describe('Replace every occurrence instead of requiring a unique match'),
            }),
            execute: async ({ slug, oldString, newString, replaceAll }) => {
                if (!scheduleExists(id, slug)) return `Schedule not found: ${slug}`
                if (oldString === newString) return 'oldString and newString are identical; nothing to do.'
                const current = await readSchedule(id, slug)
                const occurrences = current.body.split(oldString).length - 1
                if (occurrences === 0) return `oldString not found in ${slug}. Call schedule_get to read the current body, then retry with an exact excerpt of it. Never fall back to rewriting the whole body from memory.`
                if (occurrences > 1 && !replaceAll) return `oldString matches ${occurrences} times in ${slug}; pass replaceAll or provide a more specific string.`
                const body = replaceAll ? current.body.split(oldString).join(newString) : current.body.replace(oldString, newString)
                await updateScheduleAt(id, slug, { body })
                return `Edited schedule ${slug} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`
            },
        }),
        schedule_delete: tool({
            description: 'Delete a scheduled task.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!scheduleExists(id, slug)) return `Schedule not found: ${slug}`
                await deleteSchedule(id, slug)
                return `Deleted schedule ${slug}`
            },
        }),
    }
}
