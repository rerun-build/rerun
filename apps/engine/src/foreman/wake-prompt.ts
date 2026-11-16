import { mandatoryWakeAt, readWakeState } from './wake-state.js'

function when(iso: string, timezone: string | null): string {
    try {
        return new Intl.DateTimeFormat('en-GB', { timeZone: timezone ?? 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
    } catch {
        return iso
    }
}

// What the Chief of Staff planned, so it neither plans twice nor forgets what it promised.
export async function buildWakesSection(now = new Date()): Promise<string> {
    const state = await readWakeState()
    const lines = state.planned.length
        ? ['Wakes you planned:', ...[...state.planned].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(wake => `- ${wake.id}, ${when(wake.at, state.timezone)}: ${wake.reason}`)]
        : ['You planned no wake.', `Without one you wake ${state.last ? 'once a day' : 'soon'}, next around ${when(mandatoryWakeAt(state, now).toISOString(), state.timezone)}.`]
    if (state.last) lines.push(`Your last wake: ${when(state.last, state.timezone)}.`)
    return lines.join('\n')
}
