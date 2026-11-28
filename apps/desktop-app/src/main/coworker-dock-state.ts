import { COWORKER_DOCK_MAX_NOTES, COWORKER_DOCK_MOODS, type CoworkerDockCoworker, type CoworkerDockMood, type CoworkerDockNote, type CoworkerDockRect, type CoworkerDockState, type CoworkerLook } from '@rerun/contracts'

// What the pages send the shell, read without Electron: anything a page publishes is bounded and
// typed before the dock window sees it.

const MAX_COWORKERS = 100
const MAX_NOTE_TEXT = 2000
const MAX_REGIONS = 20

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.slice(0, max) : ''
}

function optionalText(value: unknown, max: number): string | null {
    return typeof value === 'string' && value ? value.slice(0, max) : null
}

const LOOK_PART = /^[a-z]{1,20}$/
const LOOK_COLOR = /^#[0-9a-fA-F]{6}$/

// Bounded and typed only: eyes, a mouth or a material added after this build ships are still ones the
// dock's page, served by the hub, knows how to draw.
function cleanLook(raw: unknown): CoworkerLook | null {
    if (!raw || typeof raw !== 'object') return null
    const { eyes, mouth, color, material } = raw as Record<string, unknown>
    const part = (value: unknown) => typeof value === 'string' && LOOK_PART.test(value)
    if (!part(eyes) || !part(mouth) || typeof color !== 'string' || !LOOK_COLOR.test(color)) return null
    if (material !== undefined && !part(material)) return null
    return { eyes, mouth, color: color.toLowerCase(), ...(material !== undefined ? { material } : {}) } as CoworkerLook
}

function cleanCoworker(raw: unknown): CoworkerDockCoworker | null {
    if (!raw || typeof raw !== 'object') return null
    const { id, name, mood, pending, look: rawLook } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !id) return null
    const look = cleanLook(rawLook)
    return {
        id: id.slice(0, 100),
        name: String(name ?? '').slice(0, 200),
        mood: (COWORKER_DOCK_MOODS as readonly string[]).includes(String(mood)) ? (mood as CoworkerDockMood) : 'idle',
        pending: Math.max(0, Math.min(9999, Math.floor(Number(pending)) || 0)),
        ...(look ? { look } : {}),
    }
}

function cleanNote(raw: unknown): CoworkerDockNote | null {
    if (!raw || typeof raw !== 'object') return null
    const { id, agentId, status, title, text: said, updatedAt, sessionId, engineSessionId, count } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof agentId !== 'string' || !agentId) return null
    if (typeof status !== 'string' || !/^[a-z_]{1,40}$/.test(status)) return null
    const folded = Math.floor(Number(count))
    return {
        id: id.slice(0, 200),
        agentId: agentId.slice(0, 100),
        status,
        title: text(title, 300),
        text: optionalText(said, MAX_NOTE_TEXT),
        updatedAt: optionalText(updatedAt, 40),
        sessionId: optionalText(sessionId, 100),
        engineSessionId: optionalText(engineSessionId, 200),
        ...(folded > 1 ? { count: Math.min(9999, folded) } : {}),
    }
}

export function cleanDockState(raw: unknown): CoworkerDockState {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { coworkers?: unknown }).coworkers)) return null
    const { coworkers: rawCoworkers, createBlockedReason, workspaceKey, notes: rawNotes } = raw as { coworkers: unknown[]; createBlockedReason?: unknown; workspaceKey?: unknown; notes?: unknown }
    const coworkers = rawCoworkers
        .slice(0, MAX_COWORKERS)
        .map(cleanCoworker)
        .filter((coworker): coworker is CoworkerDockCoworker => coworker !== null)
    const state: NonNullable<CoworkerDockState> = {
        coworkers,
        createBlockedReason: typeof createBlockedReason === 'string' && createBlockedReason ? createBlockedReason.slice(0, 300) : null,
    }
    if (typeof workspaceKey === 'string' && workspaceKey) state.workspaceKey = workspaceKey.slice(0, 100)
    if (Array.isArray(rawNotes)) {
        state.notes = rawNotes
            .slice(0, COWORKER_DOCK_MAX_NOTES)
            .map(cleanNote)
            .filter((note): note is CoworkerDockNote => note !== null)
    }
    return state
}

export function cleanRect(raw: unknown): CoworkerDockRect | null {
    if (!raw || typeof raw !== 'object') return null
    const { x, y, width, height } = raw as Record<string, unknown>
    const values = [x, y, width, height].map(Number)
    return values.every(Number.isFinite) ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null
}

export function cleanRects(raw: unknown): CoworkerDockRect[] {
    if (!Array.isArray(raw)) return []
    return raw
        .slice(0, MAX_REGIONS)
        .map(cleanRect)
        .filter((rect): rect is CoworkerDockRect => rect !== null)
}
