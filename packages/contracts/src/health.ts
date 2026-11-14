import { z } from 'zod'

export const healthSchema = z.object({
    status: z.string(),
    activeAgents: z.number(),
    capabilities: z.array(z.string()).default([]),
    dataVersion: z.number().optional(),
    dataVersionTarget: z.number().optional(),
})
export type Health = z.infer<typeof healthSchema>

export const engineDoctorCheckSchema = z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })
export type EngineDoctorCheck = z.infer<typeof engineDoctorCheckSchema>

export const engineDoctorSchema = z.object({
    ok: z.boolean(),
    dataVersion: z.number(),
    dataVersionTarget: z.number(),
    agentIds: z.array(z.string()),
    checks: z.array(engineDoctorCheckSchema),
})
export type EngineDoctor = z.infer<typeof engineDoctorSchema>

export const ENGINE_CAPABILITY_FILES_STREAM = 'files.stream'

export const ENGINE_CAPABILITY_FOREMAN_FILES = 'foreman.files'

export const ENGINE_CAPABILITY_DESKTOP = 'desktop'

export const ENGINE_CAPABILITY_SCHEDULE_RENAME = 'schedules.rename'

export const ENGINE_CAPABILITY_ARTIFACT_UPDATE = 'update.artifact'

export const ENGINE_CAPABILITY_OPENCODE = 'connections.opencode'

export const ENGINE_CAPABILITY_CUSTOM = 'connections.custom'

export const engineLastUpdateSchema = z.object({
    status: z.enum(['running', 'error', 'restarting', 'success']),
    commit: z.string().nullable(),
    error: z.string().optional(),
    at: z.string(),
})
export type EngineLastUpdate = z.infer<typeof engineLastUpdateSchema>

export const ENGINE_LAYOUTS = ['release', 'monorepo', 'image'] as const
export type EngineLayout = (typeof ENGINE_LAYOUTS)[number]
