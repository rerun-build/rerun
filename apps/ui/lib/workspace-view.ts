import type { PanelWidthConfig } from '@/lib/side-panel-width'

// The two ways to show a workspace: the isometric board, or the Simple view (a list of coworkers, the
// chat in the middle, the coworker's card on the right). Each person picks one, remembered on this device.
export type WorkspaceView = 'board' | 'simple'

export const WORKSPACE_VIEW_STORAGE_KEY = 'rerun:workspace-view'
export const WORKSPACE_VIEW_COOKIE = 'rerun-workspace-view'
const WORKSPACE_VIEW_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export function parseWorkspaceView(value: string | null | undefined): WorkspaceView | null {
    return value === 'board' || value === 'simple' ? value : null
}

export function loadWorkspaceView(): WorkspaceView | null {
    try {
        return parseWorkspaceView(localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY))
    } catch {
        return null
    }
}

// The browser's storage is the preference; the cookie only mirrors it, so the server renders the
// frame around the board (the Chief of Staff's column) already where the view puts it.
export function rememberWorkspaceView(view: WorkspaceView): void {
    try {
        localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, view)
    } catch {}
    const parts = [`${WORKSPACE_VIEW_COOKIE}=${view}`, 'path=/', `max-age=${WORKSPACE_VIEW_COOKIE_MAX_AGE}`, 'SameSite=Lax']
    if (window.location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}

export type WorkspaceViewContext = {
    // The Simple view is released to this account.
    enabled: boolean
    preference: WorkspaceView | null
    // A visitor without an account, a workspace still in its onboarding, or one waiting for a machine:
    // the onboarding draws on the board, and a waitlist has nothing to list.
    anonymous: boolean
    onboarding: boolean
    waitlisted: boolean
    // A coworker or a template is being dropped on the grid, or the workspace has no Box to list from.
    placing: boolean
    boxless: boolean
}

// The frame on screen. Anything that needs the grid wins over the preference, which comes back on its
// own once the grid is no longer needed.
export function resolveWorkspaceView(context: WorkspaceViewContext): WorkspaceView {
    if (!context.enabled) return 'board'
    if (context.anonymous || context.onboarding || context.waitlisted) return 'board'
    if (context.placing || context.boxless) return 'board'
    return context.preference ?? 'board'
}

// What the Simple view remembers as open last when it was the Chief of Staff, in place of a coworker's id.
export const FOREMAN_OPENED = 'foreman'

export type InitialOpen = { kind: 'coworker'; agentId: string } | { kind: 'foreman' } | null

// What the Simple view opens when nothing is open yet: the coworker open last on this device while it
// still exists, the Chief of Staff when it was it or when nothing was, and the most recently active
// coworker in a workspace without a Chief of Staff.
export function initialOpenOf({ remembered, agentIds, foremanVisible, mostRecent }: { remembered: string | null; agentIds: readonly string[]; foremanVisible: boolean; mostRecent: string | null }): InitialOpen {
    if (remembered && remembered !== FOREMAN_OPENED && agentIds.includes(remembered)) return { kind: 'coworker', agentId: remembered }
    if (foremanVisible) return { kind: 'foreman' }
    return mostRecent ? { kind: 'coworker', agentId: mostRecent } : null
}

// The coworker's card on the right of the Simple view. Never more than 45% of the window: the chat in
// the middle is what the view is for.
export const DETAILS_COLUMN_WIDTH: PanelWidthConfig = { storageKey: 'rerun:simple-details-width', defaultWidth: 400, min: 320, max: 800, maxViewportRatio: 0.45 }

// From `xl` the card sits beside the chat; under it, it lies over the chat and starts closed.
export const DETAILS_BESIDE_QUERY = '(min-width: 1280px)'

// The phone's list: the coworkers pinned to its top, and whether the rest reads by recency or by Box.
// Kept in the browser for each workspace, like the iOS and Android app keeps them on the phone.
export type ListGrouping = 'recent' | 'box'

const pinsKey = (workspaceId: number) => `rerun:simple-pins:${workspaceId}`
const groupingKey = (workspaceId: number) => `rerun:simple-grouping:${workspaceId}`

export function loadPins(workspaceId: number): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(pinsKey(workspaceId)) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    } catch {
        return []
    }
}

export function savePins(workspaceId: number, ids: readonly string[]): void {
    try {
        localStorage.setItem(pinsKey(workspaceId), JSON.stringify(ids))
    } catch {}
}

export function togglePin(ids: readonly string[], id: string): string[] {
    return ids.includes(id) ? ids.filter(pinned => pinned !== id) : [...ids, id]
}

export function loadGrouping(workspaceId: number): ListGrouping {
    try {
        return localStorage.getItem(groupingKey(workspaceId)) === 'box' ? 'box' : 'recent'
    } catch {
        return 'recent'
    }
}

export function saveGrouping(workspaceId: number, grouping: ListGrouping): void {
    try {
        localStorage.setItem(groupingKey(workspaceId), grouping)
    } catch {}
}
