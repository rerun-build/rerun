import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { planWake, updateWakeState, type WakeSlot } from '../../foreman/wake-state.js'

const MOVED: Record<WakeSlot['moved'][number], string> = {
    too_soon: 'moved to fifteen minutes from now, the soonest a wake can be',
    too_far: 'moved to a week from now, the latest a wake can be',
    quiet_hours: "moved out of the member's night (20:00 to 08:00 where they live)",
}

function localTime(at: Date, timezone: string | null): string {
    try {
        return new Intl.DateTimeFormat('en-GB', { timeZone: timezone ?? 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(at)
    } catch {
        return at.toISOString()
    }
}

// The Chief of Staff's own alarm clock: it plans when it looks again, and why. At that moment the box
// wakes it with the reason it gave, in a run that only reads.
export function foremanWakeTools(): ToolSet {
    return {
        schedule_wake: tool({
            description:
                'Plan a moment to wake up on your own and look at the workspace again, with the reason you will read then: check that a coworker you just set up finished its install, see how a routine went the morning after, follow up on something you proposed. Pass either inMinutes or at. A wake lands at least fifteen minutes from now, at most a week, and never in the night of the person you write to; the answer says when it really lands. At most five planned at once. Without any, you wake once a day anyway. Only promise to come back to someone once you planned it here.',
            inputSchema: z.object({
                reason: z.string().min(3).max(300).describe('What to look at when you wake, written for yourself: you will read it then and nothing else of this conversation.'),
                inMinutes: z.number().int().positive().optional().describe('Minutes from now.'),
                at: z.string().optional().describe('An ISO 8601 date and time, with its offset.'),
            }),
            execute: async ({ reason, inMinutes, at }) => {
                const now = new Date()
                const requested = inMinutes !== undefined ? new Date(now.getTime() + inMinutes * 60_000) : at ? new Date(at) : null
                if (!requested || Number.isNaN(requested.getTime())) return { error: 'Pass inMinutes, or at as an ISO 8601 date and time.' }
                return updateWakeState(state => {
                    const planned = planWake(state, requested, reason, now)
                    if ('error' in planned) return planned
                    const when = new Date(planned.wake.at)
                    return { id: planned.wake.id, at: planned.wake.at, local: localTime(when, state.timezone), ...(planned.moved.length ? { moved: planned.moved.map(key => MOVED[key]).join('; ') } : {}) }
                })
            },
        }),
        cancel_wake: tool({
            description: 'Cancel a wake you planned, by the id schedule_wake gave or the list in your wakes section.',
            inputSchema: z.object({ id: z.string().min(1) }),
            execute: async ({ id }) =>
                updateWakeState(state => {
                    const before = state.planned.length
                    state.planned = state.planned.filter(wake => wake.id !== id)
                    return state.planned.length < before ? { cancelled: id } : { error: `No planned wake has the id ${id}.` }
                }),
        }),
    }
}
