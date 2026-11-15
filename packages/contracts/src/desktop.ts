import { z } from 'zod'

export const DESKTOP_WS_PATH = '/desktop/ws'

export const DESKTOP_TICKET_TTL_MS = 60_000

export const desktopViewModeSchema = z.enum(['watch', 'drive'])
export type DesktopViewMode = z.infer<typeof desktopViewModeSchema>

export const desktopAppSchema = z.enum(['browser', 'files', 'terminal'])
export type DesktopApp = z.infer<typeof desktopAppSchema>

export const desktopAppRequestSchema = z.object({ app: desktopAppSchema })

export const desktopSessionRequestSchema = z.object({
    timeZone: z
        .string()
        .regex(/^[A-Za-z0-9_+\-/]+$/)
        .optional()
        .catch(undefined),
})

export const desktopStatusSchema = z.object({
    available: z.boolean(),
    screens: z.array(z.object({ agentId: z.string(), viewers: z.number(), takeover: z.boolean(), dock: z.boolean().default(false), agentDriving: z.boolean().default(false) })),
})
export type DesktopStatus = z.infer<typeof desktopStatusSchema>

export const takeoverUrlSchema = z.string().url().refine(url => /^https?:\/\//i.test(url), 'Only a web page can be opened')
export const takeoverRequestSchema = z.object({ url: takeoverUrlSchema.optional() })

export const takeoverResultSchema = z.object({ url: z.string().nullable(), open: z.boolean().optional() })
export type TakeoverResult = z.infer<typeof takeoverResultSchema>

export const desktopSocketRequestSchema = desktopSessionRequestSchema.extend({ mode: desktopViewModeSchema })

export const desktopSocketSchema = z.object({ socketUrl: z.string(), dock: z.boolean() })
export type DesktopSocketView = z.infer<typeof desktopSocketSchema>
