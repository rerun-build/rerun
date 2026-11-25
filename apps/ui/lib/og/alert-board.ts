import { coworkerLookSchema, providerSchema } from '@rerun/contracts'
import { z } from 'zod'

// No 'server-only': the payment notice builds its picture from the Stripe webhook and from Trigger.dev.

// The frame of the picture an alert email opens on, in CSS pixels.
export const ALERT_BOARD_SIZE = { width: 520, height: 260 }

// A cause stands in the middle of the coworkers it stopped: four slots around it.
export const ALERT_CREW_LIMIT = 4
export const ALERT_NEIGHBOUR_LIMIT = 3

const ALERT_STATES = ['question', 'approval', 'connector', 'failed'] as const
export type AlertState = (typeof ALERT_STATES)[number]

const ALERT_CAUSES = [...providerSchema.options, 'credits', 'payment'] as const
export type AlertCause = (typeof ALERT_CAUSES)[number]

const coworkerSchema = z.object({ name: z.string().trim().min(1).max(40), look: coworkerLookSchema })
export type AlertCoworker = z.infer<typeof coworkerSchema>

// What an email draws close up: one coworker in the state it is in, or the cause that stopped several
// of them. Unlike a `BoardScene`, each coworker says the look it wears in the app.
export const alertBoardSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('coworker'),
        state: z.enum(ALERT_STATES),
        coworker: coworkerSchema,
        neighbours: z.array(coworkerSchema).max(ALERT_NEIGHBOUR_LIMIT),
        app: z.string().trim().min(1).max(64).optional(),
    }),
    z.object({
        kind: z.literal('cause'),
        cause: z.enum(ALERT_CAUSES),
        coworkers: z.array(coworkerSchema).min(1).max(ALERT_CREW_LIMIT),
    }),
])
export type AlertBoard = z.infer<typeof alertBoardSchema>
