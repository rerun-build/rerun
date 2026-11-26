import { z } from 'zod'
import { providerSchema } from './agent.js'

export const scheduleKindSchema = z.enum(['instruction', 'script'])
export type ScheduleKind = z.infer<typeof scheduleKindSchema>

export const SCRIPT_TIMEOUT_CHOICES_SEC = [60, 300, 900, 3600] as const
export const SCRIPT_DEFAULT_TIMEOUT_SEC = 300
export const SCRIPT_DEFAULT_FOLDER = 'shared/'
// What a script exits with when it is stopped for running past its limit, as `timeout(1)` does.
export const SCRIPT_TIMEOUT_EXIT_CODE = 124

export const scriptNotifySchema = z.enum(['failures', 'always'])
export type ScriptNotify = z.infer<typeof scriptNotifySchema>

// A routine that runs a command as it is, with no model. `runsOn` is a linked computer's id, null for
// the workspace machine.
export const scheduleScriptSchema = z.object({
    runsOn: z.string().min(1).nullable().default(null),
    folder: z.string().max(500).default(SCRIPT_DEFAULT_FOLDER),
    timeoutSec: z
        .number()
        .int()
        .refine(value => (SCRIPT_TIMEOUT_CHOICES_SEC as readonly number[]).includes(value), 'unsupported timeout')
        .default(SCRIPT_DEFAULT_TIMEOUT_SEC),
    notify: scriptNotifySchema.default('failures'),
})
export type ScheduleScript = z.infer<typeof scheduleScriptSchema>

export const scheduleSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
    cron: z.string().nullable(),
    runAt: z.string().nullable(),
    timezone: z.string().nullable(),
    lastRunAt: z.string().nullable(),
    connectionId: z.string().nullable(),
    provider: providerSchema.nullable(),
    model: z.string().nullable(),
    // An engine older than script routines sends neither: every routine it has is an instruction.
    kind: scheduleKindSchema.default('instruction'),
    script: scheduleScriptSchema.nullable().default(null),
    body: z.string().default(''),
    createdAt: z.string(),
})
export type Schedule = z.infer<typeof scheduleSchema>

export const schedulesListSchema = z.object({ schedules: z.array(scheduleSchema) })

// A script as an agent or an API client describes it: a computer by its #handle, a limit in minutes.
export const SCRIPT_ON_WORKSPACE_MACHINE = 'workspace'
export const SCRIPT_TIMEOUT_CHOICES_MIN = SCRIPT_TIMEOUT_CHOICES_SEC.map(sec => sec / 60)

export const agentScriptInputSchema = z.object({
    runsOn: z.string().max(100).optional().describe(`The #handle of a linked computer to run it on, or '${SCRIPT_ON_WORKSPACE_MACHINE}' for the workspace machine (the default).`),
    folder: z.string().max(500).optional().describe("Where it starts. On the workspace machine: 'shared/…', the folder every coworker shares (the default), or 'workspace/…', the coworker's own. On a linked computer: a folder of that computer, its working folder when left out."),
    timeoutMinutes: z.number().int().optional().describe(`Stopped after this long and counted as failed (exit ${SCRIPT_TIMEOUT_EXIT_CODE}): ${SCRIPT_TIMEOUT_CHOICES_MIN.join(', ')}. Default ${SCRIPT_DEFAULT_TIMEOUT_SEC / 60}.`),
    notifyOnSuccess: z.boolean().optional().describe('Also notify the team when it succeeds. Left out, they hear only of a failure.'),
})
export type AgentScriptInput = z.infer<typeof agentScriptInputSchema>

// The computer the input names (a handle, a name or an id, for the engine to resolve), null for the
// workspace machine. Left out, the script stays where it ran.
export function scriptRunsOnRef(input: AgentScriptInput, current: ScheduleScript | null): string | null {
    const wanted = input.runsOn?.trim()
    if (!wanted) return current?.runsOn ?? null
    return wanted.toLowerCase() === SCRIPT_ON_WORKSPACE_MACHINE ? null : wanted
}

// `runsOn` is the computer's id once resolved, or the reference itself. What the input leaves out stays
// as it was; a folder only stays on the machine it belongs to.
export function scriptOfInput(input: AgentScriptInput, current: ScheduleScript | null, runsOn: string | null): ScheduleScript | { error: string } {
    const timeoutSec = input.timeoutMinutes === undefined ? (current?.timeoutSec ?? SCRIPT_DEFAULT_TIMEOUT_SEC) : input.timeoutMinutes * 60
    if (!(SCRIPT_TIMEOUT_CHOICES_SEC as readonly number[]).includes(timeoutSec)) return { error: `timeoutMinutes must be one of ${SCRIPT_TIMEOUT_CHOICES_MIN.join(', ')}` }
    const notify = input.notifyOnSuccess === undefined ? (current?.notify ?? 'failures') : input.notifyOnSuccess ? 'always' : 'failures'
    const folder = input.folder ?? (current && current.runsOn === runsOn ? current.folder : runsOn ? '' : SCRIPT_DEFAULT_FOLDER)
    return { runsOn, folder, timeoutSec, notify }
}
