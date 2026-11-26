import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { agentScriptInputSchema, providerSchema, scriptOfInput, scriptRunsOnRef, type AgentScriptInput, type ScheduleScript } from '@rerun/contracts'
import { deleteSchedule, listSchedules, readSchedule, scheduleExists, updateScheduleAt, writeSchedule } from '../../schedules/loader.js'
import { isValidCron, isValidTimezone, nextRunAt } from '../../schedules/cron.js'
import { isValidScriptFolder } from '../../schedules/script-run.js'
import { computerSettingsRefusal, scriptComputer } from '../../schedules/script-remote.js'
import { remoteComputersEnabled } from '../../config/env.js'
import { refusedCommand } from '../../remote/command-policy.js'
import { listComputerViews } from '../../remote/registry.js'
import { assertCommandAllowed } from '../sandbox.js'
import { slugify } from '../../lib/ids.js'
import type { RunContext } from '../../runtime/context.js'
import { PROVIDER_WITHOUT_MODEL, pinnedModel } from './automation-model.js'
import { unknownComputer } from './remote-common.js'

const SCHEDULE_CREATE_DESCRIPTION =
    'Schedule a task to run without a user message: cron to recur, runAt (ISO 8601) for a one-shot. Something to do once ("at 7pm") is runAt, never a cron. A one-shot deletes itself once it succeeds. The body is what you run when it fires. With script, the body is a shell command run as it is, with no model and no credit: use it for a fixed command that needs no judgement (run a script, a backup, a sync). Each run keeps its exit code and output, and the team hears of a failure.'

const createInput = z.object({
    name: z.string(),
    description: z.string().describe('One line describing the routine'),
    body: z.string().describe('The instruction to run when the task fires, or the shell command of a script'),
    cron: z.string().optional().describe("Cron expression, e.g. '0 8 * * *'"),
    runAt: z.string().optional().describe('ISO 8601 timestamp for a one-shot task'),
    timezone: z.string().optional().describe("IANA timezone, e.g. 'Europe/Paris'"),
    provider: providerSchema.optional().describe('Model provider to run this task under. Only with a model, and only for a provider plugged into this box.'),
    model: z.string().optional().describe("Model id to run this task under, e.g. 'claude-opus-4-8'. Only if the user asks for one: left out, the task follows your model."),
    script: agentScriptInputSchema.optional().describe('Run the body as a shell command, with no model. Never with provider, model or checkIn.'),
})

// Only the Chief of Staff keeps a promise this way.
const foremanCreateInput = createInput.extend({
    checkIn: z.boolean().optional().describe('true for a promise to come back to something: when it fires you wake in a check-in, which only reads, and you write to the person only if there is something to say. The body says what you will look at and for whom.'),
})

// A script runs what the coworker could run itself: its own shell on the workspace machine, its
// tools of a linked computer there, where the owner's settings still decide at each run.
async function settledScript(ctx: RunContext, command: string, input: AgentScriptInput, current: ScheduleScript | null): Promise<{ script: ScheduleScript; warning: string | null } | { refusal: string }> {
    const runsOnRef = scriptRunsOnRef(input, current)
    const cfg = ctx.agent.config.tools

    if (!runsOnRef) {
        if (!cfg.shell) return { refusal: 'You have no shell, so you cannot set up a command on the workspace machine. A member sets it up from the routine in the app.' }
        const script = scriptOfInput(input, current, null)
        if ('error' in script) return { refusal: `${script.error}; nothing changed.` }
        if (!isValidScriptFolder(script.folder)) return { refusal: `The folder must be inside shared/ or workspace/: ${script.folder}. Nothing changed.` }
        try {
            assertCommandAllowed(command)
        } catch (err) {
            return { refusal: `${(err as Error).message}. Nothing changed.` }
        }
        return { script, warning: null }
    }

    if (!cfg.remoteComputers || !remoteComputersEnabled()) return { refusal: 'You do not reach the linked computers, so you cannot set up a command on one. A member sets it up from the routine in the app.' }
    const { view, known } = await scriptComputer(runsOnRef)
    if (!view) return { refusal: unknownComputer(runsOnRef, known) }
    const refused = refusedCommand(command)
    if (refused) return { refusal: `Not set up on #${view.handle}: ${refused}.` }
    const script = scriptOfInput(input, current, view.id)
    if ('error' in script) return { refusal: `${script.error}; nothing changed.` }
    return { script, warning: computerSettingsRefusal(view, command) }
}

function savedScript(action: string, slug: string, warning: string | null): string {
    return warning ? `${action} schedule ${slug}, but it will fail as things stand: ${warning} Tell the user what to change.` : `${action} schedule ${slug}`
}

async function computerLabel(runsOn: string): Promise<string> {
    const view = (await listComputerViews()).find(computer => computer.id === runsOn)
    return view ? `#${view.handle}` : runsOn
}

export function scheduleTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id
    const foreman = ctx.agent.config.kind === 'foreman'
    const create = async ({ name, description, body, cron, runAt, timezone, provider, model, checkIn, script }: z.infer<typeof foremanCreateInput>) => {
        if (!cron && !runAt) return 'Provide either cron (recurring) or runAt (one-shot).'
        if (cron && runAt) return 'Provide only one of cron or runAt, not both.'
        if (cron && !isValidCron(cron)) return `Invalid cron expression: ${cron}`
        if (runAt && Number.isNaN(new Date(runAt).getTime())) return `Invalid runAt timestamp: ${runAt}`
        if (timezone && !isValidTimezone(timezone)) return `Invalid timezone: ${timezone}. Use an IANA name, e.g. 'Europe/Paris' or 'America/New_York'.`
        const slug = slugify(name)
        const existing = scheduleExists(id, slug) ? await readSchedule(id, slug) : null
        if (existing && existing.kind !== (script ? 'script' : 'instruction')) return `A routine called ${name} already exists (${slug}) and ${existing.kind === 'script' ? 'runs a command' : 'is an instruction'}: change it with schedule_update, or pick another name.`
        if (script) {
            if (provider || model || checkIn) return 'A script runs no model: leave provider, model and checkIn out. Nothing changed.'
            const settled = await settledScript(ctx, body, script, existing?.script ?? null)
            if ('refusal' in settled) return settled.refusal
            const schedule = await writeSchedule(id, { name, description, body, cron, runAt, timezone, kind: 'script', script: settled.script }, ctx.author)
            return savedScript('Created', schedule.slug, settled.warning)
        }
        const pin = await pinnedModel(ctx, provider, model)
        if ('refusal' in pin) return pin.refusal
        const schedule = await writeSchedule(id, { name, description, body, cron, runAt, timezone, ...pin, ...(foreman && checkIn ? { checkIn: true } : {}) }, ctx.author)
        return schedule.checkIn ? `Created schedule ${schedule.slug}: it wakes you in a check-in` : `Created schedule ${schedule.slug}`
    }
    return {
        schedule_list: tool({
            description: 'List your scheduled tasks (cron and one-shot), without their bodies: read one in full with schedule_get.',
            inputSchema: z.object({}),
            execute: async () => {
                const schedules = await listSchedules(id)
                if (schedules.length === 0) return 'No scheduled tasks yet.'
                const now = new Date()
                return schedules
                    .map(s => {
                        const trigger = s.cron ? `cron ${s.cron}` : `once ${s.runAt}`
                        const state = s.enabled ? `next ${nextRunAt(s, now) ?? 'never'}` : 'disabled'
                        return `- ${s.name} (${s.slug}): ${s.kind === 'script' ? 'script, ' : ''}${trigger}, ${state}`
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
                    schedule.checkIn ? 'Wakes you in a check-in' : '',
                    schedule.script
                        ? `Runs a command without a model, on ${schedule.script.runsOn ? `the linked computer ${await computerLabel(schedule.script.runsOn)}` : 'the workspace machine'}, in ${schedule.script.folder || 'its working folder'}, stopped after ${schedule.script.timeoutSec / 60} min, notifies ${schedule.script.notify === 'always' ? 'every run' : 'only a failure'}`
                        : '',
                    '',
                    schedule.script ? `Command: ${schedule.body}` : schedule.body,
                ]
                return lines.filter(Boolean).join('\n')
            },
        }),
        schedule_create: foreman ? tool({ description: SCHEDULE_CREATE_DESCRIPTION, inputSchema: foremanCreateInput, execute: create }) : tool({ description: SCHEDULE_CREATE_DESCRIPTION, inputSchema: createInput, execute: create }),
        schedule_update: tool({
            description:
                'Update an existing scheduled task (description, cron, runAt, timezone, provider, model, script settings, or enable/disable it). An instruction stays an instruction and a script stays a script: delete and recreate to change that. Passing body overwrites the entire instruction body, discarding all of its existing content: use it ONLY for a deliberate full rewrite of a body you have just read with schedule_get, never for one you reconstructed from memory. For ANY partial change to the body, use schedule_edit instead.',
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
                script: agentScriptInputSchema.optional().describe('Change where and how a script runs. Only on a script.'),
            }),
            execute: async ({ slug, description, body, cron, runAt, timezone, enabled, provider, model, script }) => {
                if (!scheduleExists(id, slug)) return `Schedule not found: ${slug}`
                if (cron && !isValidCron(cron)) return `Invalid cron expression: ${cron}`
                if (runAt && Number.isNaN(new Date(runAt).getTime())) return `Invalid runAt timestamp: ${runAt}`
                if (timezone && !isValidTimezone(timezone)) return `Invalid timezone: ${timezone}. Use an IANA name, e.g. 'Europe/Paris' or 'America/New_York'.`
                if (provider && !model) return PROVIDER_WITHOUT_MODEL
                const pin = model ? await pinnedModel(ctx, provider, model) : {}
                if ('refusal' in pin) return pin.refusal
                const current = await readSchedule(id, slug)
                if (current.kind === 'script' && (model !== undefined || provider !== undefined)) return 'A script runs no model: leave provider and model out. Nothing changed.'
                if (current.kind !== 'script' && script) return `${slug} is an instruction: to run a command instead, delete it and create a script. Nothing changed.`
                let warning: string | null = null
                let nextScript: ScheduleScript | undefined
                if (current.kind === 'script' && (script || body !== undefined)) {
                    const settled = await settledScript(ctx, body ?? current.body, script ?? {}, current.script)
                    if ('refusal' in settled) return settled.refusal
                    warning = settled.warning
                    nextScript = settled.script
                }
                await updateScheduleAt(id, slug, { description, body, cron, runAt, timezone, enabled, ...pin, ...(nextScript ? { script: nextScript } : {}) })
                if (warning) return savedScript('Updated', slug, warning)
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
                // A script's command is checked again when it changes, as when it was set up.
                const checked = current.kind === 'script' ? await settledScript(ctx, body, {}, current.script) : null
                if (checked && 'refusal' in checked) return checked.refusal
                await updateScheduleAt(id, slug, { body })
                const edited = `Edited schedule ${slug} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`
                return checked?.warning ? `${edited}, but it will fail as things stand: ${checked.warning} Tell the user what to change.` : edited
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
